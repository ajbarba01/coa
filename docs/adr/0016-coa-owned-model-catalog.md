# 0016. The model catalog is coa-owned; the backend read enriches, never defines

- Status: accepted
- Date: 2026-07-18

## Context and problem

Every place the console chooses a model (the in-chat model chip, the agent-config picker) was fed by the
backend's live model fetch, merged per account. That feed is not authoritative: the Claude Agent SDK
advertises **five aliases only** (`default`/`sonnet`/`opus`/`haiku`/`fable`) while the subscription honors
explicit older ids the fetch never mentions (verified live in the 2026-07-12 model-access spike —
`claude-sonnet-4-6` ran fine when named explicitly). DeepSeek/LongCat return real id lists but no reasoning
capabilities. So the set of models that *actually work* is not something any backend reliably tells us, and
the user had no way to add, rename, hide, or remove entries — reaching an un-advertised model meant editing
source.

## Decision drivers

- **The backend is the authority on execution, not on enumeration.** An id the list doesn't show still runs
  when sent; an id the list shows may not exist. Enumeration must therefore be curated where the knowledge
  lives — with us and with the user.
- **Never-cage (SC-1/D85).** Whatever owns the list must not become a gate: an empty list, a removed id, a
  hand-typed unknown id all keep working.
- **Strict-superset.** A user who never touches the editor must see exactly today's pickers.

## Decision

The per-provider model list the pickers consume is the **user's editable list** in `~/.coa/models.yaml`
(`ModelCatalogStore`), **seeded** from a coa-shipped, hand-verified default catalog
(`packages/core/src/models/default-catalog.ts`) the first time a provider's list is written. The live fetch
is demoted to **enrichment**: it supplies per-id capabilities and populates "add from defaults", never
membership. A pure assembler (`effectiveModels`) resolves each entry's fields as user override → live fetch
→ shipped catalog → bare `{id}`, and the daemon's `listModels` verb serves that projection to both pickers.

The catalog carries a `last-verified` date and is re-verified when Claude ships new ids — reaching a new or
older model is a catalog/list change, not a rearchitecture.

## Consequences

- Editing the list in the Auth surface is the supported way to reach un-advertised models; hide (visibility)
  and remove (membership) stay distinct, and only removing a *custom* entry confirms (no catalog to re-add
  it from).
- Never-cage holds structurally: an emptied list serves empty (the picker falls back to the backend
  default); a removed or hidden id still runs on the wire for anything pinned to it; an unknown id assembles
  to a bare runnable descriptor.
- The `COA_DEEPSEEK_EFFORT`/`COA_LONGCAT_EFFORT` env maps survive as the lowest-precedence capability tier,
  superseded by any UI-set reasoning profile.
- The renderer's static provider model arrays are gone; a stale catalog is now a data bug with one home,
  not a scatter of hardcoded lists.
