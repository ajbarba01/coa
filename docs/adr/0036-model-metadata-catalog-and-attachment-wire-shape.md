# 0036. A merged model-metadata catalog, and attachments ride the existing message shape

- Status: accepted
- Date: 2026-08-09

## Context and problem

The Composer needed a live, honest picture of the active model — context window, pricing, modalities,
reasoning support — to drive a context ring and gate an attach control. coa already owns a model
catalog (`packages/core/src/models/`, ADR 0016) for **enumeration**: which model ids exist, and their
reasoning-effort ladder. That catalog does not carry context window, pricing, or modality info, and its
"coa-curated, backend enriches" posture is wrong for this data — no backend enumerates its own context
window or price over the wire the way it enumerates model ids.

Separately, an attachment (image or text file) needed a wire shape every backend adapter could carry,
without adding a parallel format next to the existing conversation record.

## Decision drivers

- **Absent, never fabricated (maintainer-ruled).** A model this catalog has no opinion about must render
  as honestly unknown, never a guessed context window or a false "no vision."
- **Offline never breaks (D85 strict-superset).** The floor works with zero network.
- **One wire shape, not a parallel one.** `@coa/shared`'s `BackendMessage` is already "the neutral
  chat-transcript record" every adapter consumes; a second attachment carrier next to it would be the
  exact drift the M0 schema convention exists to prevent.
- **No adapter fan-in into core.** `core` may not import an adapter package (REPO_LAYOUT's
  `backend-fan-in-is-injected`), so a capability boolean crosses that seam only as a plain injected value,
  never a live catalog lookup performed adapter-side.

## Decision

**A new, separate module** — `ModelMetadata` (`@coa/shared`) + the fetch/merge/cache machinery
(`packages/core/src/models/metadata-*.ts`) — carries this richer info, distinct from the existing
enumeration catalog. Three layers merge in fixed priority, later overriding only the fields it actually
carries: a hand-curated **static** floor (bundled, zero network) < **models.dev** (the cross-provider
base, keyed by provider) < **OpenRouter's live `/models`** (current pricing/availability for
OpenRouter-routed ids specifically). Keyed by `${provider}:${id}` so a routed id
(`openrouter:anthropic/claude-sonnet-4.5`) and the same model under its native provider
(`claude:claude-sonnet-5`) stay two rows. A failed fetch resolves to `undefined`, not `[]`, so a transient
network failure can never overwrite a good cache with an empty one. `ModelMetadataCatalog` reads its
disk cache synchronously at construction (never a network call) and exposes `refresh()` for the daemon to
call off the critical path.

**Attachments extend `BackendMessage`** with one new optional field, `attachments: Attachment[]`
(`@coa/shared/attachment.ts`) — a discriminated union of `image` (mime type + base64 bytes) and `text`
(inlined unconditionally, no capability gate). `GovernedLoopDeps.input` gained a matching optional
`attachments` field so a live turn's first message carries them through `@coa/loop-driver` the same way
history replay already does. The vision **capability check lives at the adapter's wire-mapping seam**
(`adapter-openai-compat`'s `toWireMessage`), gated by a plain `visionSupported: boolean` the caller injects
(from this catalog's `modelImageInputSupport`) — not a second capability table inside `ProviderSpec`. A
mismatch on the LIVE turn's own attachment throws `AttachmentCapabilityError`, a typed reject the caller
surfaces, never a silent drop or a malformed request sent to the backend. An unsupported image sitting in
the RESENT history (from an earlier turn, possibly authored under a different, vision-capable model)
degrades to a neutral text note instead — `complete()`'s `historyBoundary` marks where the live turn begins,
so a model switch never breaks every later plain-text turn over an attachment the user isn't even touching.

## Consequences (good / bad)

**Good** — offline is unaffected (the static floor answers `get`/`list` before any `refresh()` resolves);
adding a model to the static floor or fixing a stale price is a data change, not a rearchitecture (same
posture as ADR 0016's `default-catalog.ts`); the attachment shape needs no new adapter-side schema
knowledge — every consumer of `BackendMessage` already round-trips it for free.

**Bad** — two catalogs now live under `packages/core/src/models/` (enumeration vs. rich metadata) with
similar-sounding names; a future reader must check which one a given field belongs to. Accepted: their
lifecycles are genuinely different (user-editable SOT vs. a read-only merged mirror of public data), and
folding them into one shape would force the enumeration catalog's "coa is authoritative" posture onto data
coa has no authority over. The live single-turn send path (Composer → RPC → session → adapter `input`) does
not yet plumb an attachment end-to-end — this ADR's wire shape and adapter seam are ready for it, but the
UI-facing wiring is separate follow-up work, not covered here.

---

_Last reviewed: 2026-08-09_
