# Editable model list as source of truth — design

_Design date: 2026-07-18. Status: approved; amended same day after the mockup pass and maintainer review
(add-from-defaults is a dialog; model rows get the right-click menu)._

Make the per-provider **model list user-editable** and the **single source of truth** for every place a
model is chosen — the in-chat model chip and the agent-config picker. The user gets full control over which
model ids exist for a provider (add from a coa-owned default catalog, create a custom one, edit, hide,
remove), because the SDK/backends do not reliably advertise the concrete model ids that actually work.

This is Phase-1-adjacent polish, done **before** Auth Phase 2 (Usage). It builds on the committed auth
backend (`assembleAuthView`, `console.yaml`, the RPC-verb pattern) — see
`2026-07-17-auth-usage-backend-phase1-design.md` and [[auth-backend-phase1-done]].

---

## 1. The one architectural idea

Today there is no user model list. Two disconnected sources exist:

- **Live fetch** — `fetchClaudeModels` → `ModelCache` → `state.data.models`, already the single feed for
  *both* the chat chip (Composer) and the agent picker (AgentsPanel). For Claude the SDK returns **only 5
  aliases** (`default`/`sonnet`/`opus`/`haiku`/`fable`); DeepSeek/LongCat return their real `/models` list
  but **no reasoning capabilities**.
- **Hardcoded mock** — `PROVIDERS[].models` in the renderer, used only by the Auth surface's display.
- **`hiddenModels`** — renderer-only visibility state, no persistence.

The new model:

```
models.yaml  (NEW: per-provider curated list — ids, labels, reasoning profiles, hidden flags)
      │
      │  effective list = user's list (minus hidden), each model's caps resolved as:
      │      user override  →  live fetch caps  →  shipped defaults
      ▼
state.data.models  ──►  in-chat model chip (Composer)
                   └──►  agent-config picker (AgentsPanel)
```

`models.yaml` is the **SOT**. The live fetch is demoted to **enrichment** (supplies capabilities by id and
populates the "add from defaults" catalog), never the direct feed. This *supersedes* the
`COA_DEEPSEEK_EFFORT` / `COA_LONGCAT_EFFORT` env maps — editing a reasoning ladder in the UI is what those
env vars do today (they remain a lower-precedence fallback, not removed).

---

## 2. The default catalog (coa-owned)

The premise "a default list from the backend of models that definitely exist" is only half-true: the
backend advertises **aliases only**, so the authoritative "these work" set is **coa-curated**, not fetched
(see [[model-access-spike]]). Therefore:

| Provider | Default-catalog source |
| --- | --- |
| **Claude** | coa-shipped, hand-verified catalog (today's `providers.ts` list, promoted to a real catalog + ADR). |
| **DeepSeek / LongCat** | their live `/models` fetch (+ shipped effort-cap defaults). |

The catalog is the source for **"add from defaults"** and for **seeding** (§3). It carries the same
per-model reasoning caps the effective list needs, so adding from defaults is zero-config.

**Durable decision → ADR:** "the model catalog is coa-owned, versioned by us, enriched (not defined) by the
backend read." Carries a `last-verified` discipline since the concrete Claude ids drift.

---

## 3. Seeding (chosen shape: "B" — defaults appear by default)

The first time a provider is present, its `models.yaml` list is **lazily materialised** from that
provider's default catalog. A freshly-seeded list renders **identically to today** — the defaults are the
current set, just now editable. Not a global migration; per-provider, on first need.

Empty is a legal state: an emptied list ⇒ the picker falls back to **"backend default"** (model unset,
never a broken empty picker). You can remove every model if you want.

---

## 4. The model entry

`models.yaml`, keyed by provider. Each entry:

| Field | Required | Notes |
| --- | --- | --- |
| `id` | ✅ | the string actually sent to the backend |
| `label` | — | picker label; defaults to `id` |
| `reasoning` | — (Advanced) | effort ladder (`low`…`max`) · thinking on/off toggle · adaptive-thinking budget · none. Defaults to **inherit** from catalog/provider. |
| `hidden` | — | dropped from the pickers, kept in the list |

Provider is the map key, so an entry need not repeat it.

---

## 5. Editing — in the Auth surface, per provider

Extends the existing per-provider models section. Actions:

- **Add from defaults** — pick catalog models not yet in your list. **A dialog** (the `AddProviderDialog`
  idiom: `ModalShell`, checkmark rows, count-carrying commit, Escape/backdrop dismiss) — not an inline
  expansion. Create-custom stays inline (a form you type into next to the list it joins).
- **Create custom** — `id` + provider required; `label` optional; `reasoning` optional (Advanced,
  defaults to inherit).
- **Edit** — label + reasoning profile.
- **Hide / show** — toggle out of the pickers; stays in the list. Reversible in one click. The everyday
  declutter action.
- **Remove** — deletes the entry. **Confirm only for custom models** (irreversible — no catalog to re-add
  from); removing a default is unconfirmed (re-addable from the catalog in two clicks).

**Hide vs remove are distinct and both pull weight:** hide = "not in my pickers right now"; remove = "not
in my list at all." Remove is the *only* way to delete a custom model, so collapsing the two would strand
custom entries as permanently-hidden clutter.

**Right-click** on a model row opens the *same* ⋯ row menu anchored under the cursor — the exact pattern
the credential rows wear (controlled menu + anchor point, event claimed, portal-aware). No second context
menu to drift out of sync.

---

## 6. Capability resolution + precedence

The effective `ModelDescriptor` each picker consumes resolves each field as:

1. **User's explicit override** (label, reasoning profile) — the SOT wins.
2. **Live fetch** by matching id (Claude SDK caps; DeepSeek/LongCat live ids).
3. **Shipped defaults** (`DEFAULT_EFFORT_CAPS`, catalog caps) — this tier still honours the existing
   `COA_*_EFFORT` env override, so the env maps survive as the lowest-precedence fallback, superseded by any
   UI-set profile (§1).

Unknown/hand-typed ids with no override and no live match default to a never-cage profile (offer the
provider's known ladder rather than an empty one; the backend stays the real authority — an invalid effort
errors and surfaces, it is never blocked). This preserves the existing graceful degradation in
`modelReasoningCaps` / `clampReasoning`.

---

## 7. Never-cage guarantees (SC-1 / D85)

- **Empty list** ⇒ picker falls back to backend default. Never a broken picker.
- **Removed/hidden model still runs** if a session or agent is already pinned to that id — remove/hide are
  **visibility only**; the id string remains valid on the wire.
- **Feature untouched** ⇒ strict-superset holds: seeding reproduces today's defaults exactly, so a user who
  never opens the editor sees no change.

---

## 8. Plumbing

- **`ModelCatalogStore`** — new core store over `~/.coa/models.yaml` (0600, versioned, drop-unknown /
  never-throw), mirroring `ConsoleStateStore` / `KeyStateStore`. Its own focused module + tests.
- **Default catalog module** — the coa-owned Claude catalog (shared/core), read by seed + "add from
  defaults".
- **Effective-list assembler** — pure: `models.yaml` × live fetch × shipped defaults → the effective
  `ModelDescriptor[]` for `state.data.models`. Testable without a backend.
- **RPC verbs** — `listModels` / `addModels` (from defaults) / `addCustomModel` / `editModel` /
  `removeModel` / `setModelHidden` / `listDefaultCatalog`, over the store, mirroring the auth-verb pattern
  in `buildAuthHandlers`. Seeding (§3) happens daemon-side, on first read.
- **Renderer** — the mock spine becomes a store that mirrors the daemon (the `mockAuth.ts` pattern:
  hydrate + reproject the returned view on every write); the temporary client-only `hiddenModels` state is
  replaced by store-backed reads; the chat chip and agent picker keep reading `state.data.models`, now the
  effective list.

---

## 9. Testing

- `ModelCatalogStore` pure file-ops over a temp home (incl. empty/strict-superset case, drop-unknown).
- Effective-list assembler: precedence table (§6) unit-pinned per branch.
- Seeding: first-touch materialisation reproduces the catalog; idempotent.
- Remove/hide semantics + custom-vs-default confirm gating.
- RPC verbs over a temp store.
- Never-cage: pinned-to-removed-id still resolves a runnable selection.

---

## 10. Sequencing

0. ~~High-fidelity in-app mockup pass~~ — **done** (branch `mockups/model-list-and-login`).
1. M0/shared: model-entry schema + `models.yaml` schema.
2. `ModelCatalogStore` + default-catalog module (TDD).
3. Effective-list assembler (TDD).
4. RPC verbs + daemon wiring.
5. Renderer: per-provider editor, drop `hiddenModels`, point pickers at the effective list.
6. ADR: "coa-owned model catalog; backend read enriches, never defines."

---

_Last reviewed: 2026-07-18._
