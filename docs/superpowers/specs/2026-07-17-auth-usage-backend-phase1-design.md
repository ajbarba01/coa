# Auth + Usage backend wiring — Phase 1 design

_Design date: 2026-07-17. Status: approved, pre-implementation._

Wire the coa **Auth** surface from mock-fed to real daemon RPC. The UI is built, committed, and green;
this is "swap the data source under a frozen contract, keep the types." **Usage** (spend + limits) is
Phase 2 (spike-gated) and out of scope here.

The frozen contract is the mock store: `apps/desktop/src/renderer/panels/mockAuth.ts`. Every zustand
action maps 1:1 to an RPC verb; the exported `Credential` interface is the exact view shape the daemon
must return. Preserve those types as the edge schema.

---

## 1. The one architectural idea

The frontend `Credential` is a **projection over two structurally different backend stores**. Phase 1 is
that projection plus write-verbs routed to the correct store by provider group.

```
accounts.yaml   (backends: claude / deepseek / longcat)     ┐
web.yaml        (services: tavily / firecrawl / parallel / exa) ├─► auth-view assembler ─► unified Credential[] view
web-keys.json   (breaker cooldowns, read-only)              │        (+ enabled / chains / added)
console.yaml    (NEW: entity-less provider + UI state)      ┘
```

**Provider set in scope:** claude / deepseek / longcat (backends) + tavily / firecrawl / parallel / exa
(services) — the set that is actually runnable today. `codex` and `gemini` appear in the renderer's
`providers.ts` but have **no adapter**, so Phase-1 core does not handle them (the deferred
"unadapted providers" decision). They remain visible in the catalogue but are not wired.

---

## 2. Where bench state lives (the industry-standard split)

The three-level bench (provider · login · key) is **status-on-the-entity wherever an entity exists**, and
a small side-store only for the genuinely entity-less state.

Benching a credential means "still configured, **just not used**" — so a benched credential must actually
stop serving, not merely be marked in the UI. That requirement dictates placement:

| Bench level | Storage | Enforcement |
| --- | --- | --- |
| **Service key** (tavily-3, …) | `web.yaml` — credential entry gains `disabled` (**restructure**) | egress chain skips `disabled` inline |
| **Service provider** (tavily) | `web.yaml` — provider entry gains `disabled` | egress chain skips the whole entry |
| **Backend login** (worm, ds) | `accounts.yaml` — `accountSchema.disabled` | heir-promotion / active-pointer; never touches egress |
| **Backend provider** (longcat) | `console.yaml` (no entity) | session-start / view; not egress |
| `addedProviders` (empty-state) | `console.yaml` | view only |
| `hiddenModels` (Phase 3) | `console.yaml` (reserved) | view only |

**Why service bench is on-entity, not in the side-store.** The web egress chain
(`buildSearchChain` / `buildFetchChain` in `web-config.ts`) is the code on the wire when a governed
session calls `WebSearch` / `WebFetch`. A benched key must drop out of that chain, so *something* on the
egress path must consult bench state regardless of where it is stored. On-entity makes that a one-line
`if (cred.disabled) continue;` in a loop the builder already runs — one source of truth — versus a
side-store the egress path would have to import and join by `locatorId`. On-entity is the smaller, correct
touch. A bug on this path **degrades silently** (SC-1/D85: search returns empty, fetch drops to the free
floor, no error), so the change is deliberately mechanical and fully test-pinned, with a back-compat
migration so existing `web.yaml` files keep parsing.

**Why the rest is a side-store.** `addedProviders`, backend-provider bench, and (later) `hiddenModels`
have no entity to hang on and never gate egress. `console.yaml` mirrors `KeyStateStore` exactly: a
versioned, credential-blind file of id-sets. Its only weakness — orphaned ids after a credential is
removed — is neutralised **by construction**: the assembler always joins these id-sets against the live
credential list, so a stale id matches nothing and is ignored (plus opportunistic prune on remove).

**Stable credential id:** `` `${providerId}:${label}` `` — unique in both stores (accounts enforce unique
label; a service key's label derives from its `web-<label>` key-file path).

---

## 3. Secret display

- **Pointers** (`config-dir`, `env-var`) show their readable value verbatim (`~/.claude`, `DEEPSEEK_KEY`).
- **Secrets** (`key-file`: deepseek / longcat / all services) show a fixed `••••`. coa genuinely cannot
  read the 0600 file back, so nothing derived from the secret is shown or persisted. This is a deliberate
  (small) departure from the mock's `sk-9…4f1` prefix/tail flourish, which only worked because the mock
  held the secret in memory.

---

## 4. Phase-1 view fields — populated vs. honestly absent

| Populated now | Absent until Phase 2 (needs the M9 read / ledger) |
| --- | --- |
| `id`, `providerId`, `label`, `masked`, `disabled` | `identity`, `plan`, `expired` |
| provider `enabled` / `added`, `chains` | `lastUsed` |
| service `coolingSec` (from `KeyStateStore`) | backend cooldown (breaker is web-only today) |

The surface already treats the absent fields as optional and degrades them honestly, so a claude row shows
its pointer + label with "identity unknown until Phase 2" rather than inventing data.

---

## 5. Schema changes (M0 / core)

- `packages/shared` `accountSchema` **+= `disabled: z.boolean().default(false)`** (additive, drop-safe).
- `web-config.ts`: new `webCredentialSchema = { locator: locatorSchema, disabled: z.boolean().default(false) }`;
  `search`/`fetch` provider entries **+= `disabled: z.boolean().default(false)`**; a per-element
  back-compat **union** accepts old bare-`Locator[]` files and wraps them (`locator`, `disabled:false`).
- **New** `console.yaml` schema (in `packages/shared` or core): `{ version: 1, addedProviders: string[],
  disabledProviders: string[] }` (`hiddenModels` reserved). Credential-blind; validated drop-unknown /
  never-throw like `KeyStateStore`.

---

## 6. The verbs (all thin local file ops — no model call, P1-clean)

**Read** — `authView()` → `{ added, credentials, activeByProvider, enabled, chains }` (one read, the whole
auth slice; mirrors the existing `accountsView`).

**Writes** (1:1 with the mock actions, routed by provider group):

| Verb | Backend route | Service route |
| --- | --- | --- |
| `addProvider` / `removeProvider` | `console.yaml addedProviders`; remove cascades: delete creds + unlink key files | same |
| `addCredential(providerId, label, secret)` | key-file → write 0600 + `registry.add`; config-dir/env-var → pointer add | `WebConfigStore.addCredential` + write 0600 |
| `replaceSecret(id, secret)` | rewrite same 0600 path, clear cooldown | same |
| `renameCredential(id, label)` | re-key account label | rename `web-<label>` file + re-point locator |
| `removeCredential(id)` | `registry.remove` + unlink + heir promotion | `WebConfigStore.removeCredential` + unlink |
| `setProviderEnabled(id, on)` | `console.yaml disabledProviders` | `web.yaml` provider `disabled` |
| `setCredentialDisabled(id, on)` | `accountSchema.disabled`; benching the active login **unseats + promotes heir** | `web.yaml` credential `disabled` |
| `makeActive(id)` | `registry.setActive` (guard disabled/expired) | n/a (services are a pool) |
| `clearCooldown(id)` | n/a | `KeyStateStore.clear(locatorId)` |
| `refresh()` | re-emit the view (real pointer re-read is Phase 2) | same |

`setModelHidden` and per-provider model reads → Phase 3, out of scope.

**Heir promotion** (owned by the assembler, mirroring `mockAuth`): benching or removing the active backend
login promotes the next non-disabled, non-expired sibling; if none, the provider falls to ambient. Never
leave "disabled but active."

**Note — service rename is the fiddliest verb** (the key-file path *is* the id, so rename re-keys the
file and re-points the locator). Kept in Phase 1 per approval; called out as the highest-care unit.

---

## 7. Files

- **New** `packages/core/src/console/console-state-store.ts` — the `console.yaml` store (`KeyStateStore` twin).
- **New** `packages/core/src/rpc/auth-view.ts` — the assembler: reads all four sources, emits the view,
  owns the id scheme + heir promotion.
- **Extend** `packages/core/src/rpc/auth-handlers.ts` — the new verbs.
- **Extend** `packages/core/src/workbench/web/web-config.ts` + `web-config-store.ts` — the restructure,
  migration, egress skip-disabled, `setDisabled`.
- **Touch** `apps/cli/src/web-cli.ts` — one `.locator` access under the new shape.
- **Extend** `packages/console-viewmodel/src/reads.ts` — edge Zod for the view (preserving the mock's
  `Credential` interface as the contract).
- **Renderer** — swap `mockAuth`'s data source to the IPC-bridged view, keep every selector; main-process
  IPC wiring per the `mockAgents` → live precedent.
- **Docs (same-commit)** — `docs/design/handoff/spec/M10.md` AUTH-* status; `ROADMAP.md` W5.

---

## 8. Testing (TDD)

Pure assembler + stores unit-tested over a temp `home` (the existing registry-test pattern):

- id scheme; **join-against-live** (orphaned `console.yaml` id is dropped);
- heir promotion on bench and on remove; "disabled but active" never occurs;
- `••••` for key-file vs. verbatim pointer display;
- cascade delete + key-file unlink; shared-key survives until removed from both chains;
- egress chain **skips disabled** credential and disabled provider;
- back-compat migration: an old bare-`Locator[]` `web.yaml` still parses and routes;
- service `coolingSec` read from `KeyStateStore`.

Then **drive the running app** to verify (the handoff's non-negotiable) — add/replace/remove a credential,
bench a key and confirm it leaves the pool, switch the active login.

---

## 9. Explicitly out of scope (Phase 2 / 3)

- Usage read (identity + limits + spend via the one M9 port) — Phase 2, spike-gated.
- Per-provider live model lists + `hiddenModels` write — Phase 3.
- `codex` / `gemini` wiring — deferred with the unadapted-providers decision.
- The one-surface-vs-two question — resolved: two surfaces stay (the running app is the frontend SSOT).
