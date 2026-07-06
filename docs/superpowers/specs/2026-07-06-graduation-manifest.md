# Graduation extraction manifest

**Status:** transient ledger (deleted in Phase 3 with the graveyard it indexes).
**Purpose:** every durable decision in the graveyard → its new permanent home → status. Phase 3 deletes a
source file only when every durable row from it maps to a live home here (the graduate-before-delete gate).
**Cross-checked against:** the master de-drift spec Appendix A.

## Legend
- **Home:** `ADR NNNN` · `SPEC Mx §y` · `ROADMAP` · `code comment` · `package README` · `already-in-code (pointer)`
- **Status:** `authored-now` (done in Phase 1) · `residue-for-Phase-3` (agents transcribe later)

---

## docs/design/research/dual-backend-integration.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| One backend-blind core (M0–M8), one seam (M9 `RuntimeAdapter`, D109); capability port never branches on backend, always a null-fallback | ADR 0002 | authored-now | Core thesis of the ADR. |
| Fat (Claude SDK owns the loop) vs. thin (coa owns the loop via `complete()` + `@coa/loop-driver`) adapter split | ADR 0002 | authored-now | Verified shipped: `packages/loop-driver`, `packages/adapter-deepseek`, `packages/adapter-longcat` all exist. |
| The neutral construction seam (D121 `SessionAdapterInit`) + `TurnFrame`/`Push` wire vocabulary + `string \| AsyncIterable<string>` input | ADR 0002 | authored-now | The one wire; no SDK type crosses into core. |
| `createAdapter` routes on `ModelSelection.provider`; capability profiles + null-fallback degrade (e.g. `refs`→tree-sitter floor) | ADR 0002 | authored-now | |
| The M9 5-package identity (`spi`, `loop-driver`, `adapter-claude-sdk`, `adapter-deepseek`, `adapter-longcat`) | SPEC M9 §adapters | authored-now (Plan B) | Verified: all five packages exist under `packages/`. Corrects SPEC.md's stale `(spi + adapter-claude-sdk)` title. |
| `createSession` calls the same port methods in the same order for both backends (the elegance table) | SPEC M8 §session | authored-now (Plan B) | |
| Concrete Claude-adapter wiring (`renderNative`, `registerTools`, `denyBuiltins`, hooks) | already-in-code (pointer) | authored-now | `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts`, `render-native.ts`, `sdk-options.ts`. |

## docs/design/research/pieces-and-dual-backend-spec.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| The neutral baseline Piece set (A1) authored once, consumed by both backends; the neutral tool set (A2) reused from M6's catalogue | ADR 0002 + ADR 0003 | authored-now | Split: backend delivery mechanics → 0002; the Piece/role composition model that superseded this → 0003. |
| **D-P1 — keep the custom-string path, do NOT use `preset:'claude_code'`** | ADR 0004 (superseded) | authored-now | **Reversed.** `core-context-and-roles-spike.md` DC-5 supersedes D-P1; the ADR records D-P1 as history, not current truth (verified live in `sdk-options.ts`, see drift log below). |
| **D-P2 — cache-friendly ordering: volatile env content last, preserving the byte-stable-prefix cache invariant** | ADR 0003 (DC-6) + already-in-code (pointer) | authored-now | Absorbed by DC-6's ordered slot skeleton, not superseded. Verified shipped verbatim: `packages/core/src/session/baseline-pieces.ts` cites "per D-P2" in its volatile-tail comment; `packages/core/src/compiler/compile.ts` implements the D105 most-stable-first sort. |
| **D-P3 — one source, two consumers: where the baseline Piece set physically lives (built-in package vs seeded `.coa/`)** | ADR 0003 (DC-12) — open sub-question | residue-for-Phase-3 | **Still genuinely open.** This spec marked it OPEN (§F, "recommend built-in"); `core-context-and-roles-spike.md` §4 re-lists it as an inherited open item, not a settled one. DC-12 (ADR 0003) covers the general built-in∪user-`.coa/` merge *mechanism*, not this specific placement call. See `## OPEN — needs a home` below. |
| D-T2 — Edit not denied by default; reverse `denyBuiltins(['Edit'])` | ADR 0005 | authored-now | Ties to base-tools/governed-tools posture. Verify current `denyBuiltins` behavior when authoring the ADR text. |
| **D-T1 — lean on Claude's training via canonical names / `toolAliases`** | ROADMAP (possibility, not shipped) | residue-for-Phase-3 | **Decided-but-not-built.** `rg -n "toolAliases" packages/` → zero hits. ADR-0004's layer-on-native model achieves the canonical-naming half via the preset delta, but the specific `toolAliases` mechanism (governed tool routes under the canonical name) was never implemented. Record honestly as an unshipped possibility, not a live decision. |
| **D-T3 — kernel vs on-demand tool partition (D100)** | SPEC M6 §base-tools + already-in-code (pointer) | authored-now (Plan B), partial | **Partially shipped.** The data model is real and verified: `packages/core/src/workbench/catalogue.ts` has `ToolPartition`, the partitioned `TOOL_CATALOGUE`, and `kernelTools`/`findTools`/`loadTool` functions. But the intended *gating* behavior is NOT wired — `governed-tools.ts`'s `buildGovernedTools` registers every catalogue entry (kernel **and** on-demand) unconditionally, and `find_tools`/`load_tool` are not themselves exposed as callable tools anywhere; `findTools`/`loadTool` are only re-exported from `packages/core/src/index.ts`. Matches the `m6-status` memory's "Floored: ... find_tools/load_tool proxy." The remaining discovery-proxy work is a ROADMAP item, not done. |
| The `complete()` primitive + coa-owned loop driver (the one real backend asymmetry) | ADR 0002 | authored-now | Shipped as `@coa/loop-driver`'s `runGovernedLoop`. |
| **D-L1 — loop ownership: one shared driver vs. one loop per adapter (recommend shared)** | ADR 0002 | authored-now | Recorded for the labeled decision ID's own traceability (the row above already covers the shipped artifact). **Resolved SHARED** — built as `@coa/loop-driver`'s `runGovernedLoop`, per the `deepseek-adapter-direction` memory (2026-07-02). Same open question is raised again in `dual-backend-integration.md` §5 ("the one real asymmetry... OPEN") — one decision, cite both sources. |
| Tool-description minimalism — how far to lean on Claude's training priors vs. ship full descriptions for every tool (Part F) | OPEN — needs a home | residue-for-Phase-3 | Genuinely unresolved trade-off, not a decision — one neutral tool-description set must serve a prior-rich backend (Claude) and a prior-free one (DeepSeek/LongCat). See `## OPEN — needs a home` below; do not force an ADR line for it. |
| Build order (baseline Pieces → config hardening → assemblePieces wiring → parity package → complete()/loop driver → DeepSeek go-live) | ROADMAP | residue-for-Phase-3 | Historical sequencing only; current state is already past this — a status note, not a decision. |

## docs/design/research/pure-api-base-tools.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| coa must own Read/Glob/Grep/Write/Edit/Bash on the pure-API path (Claude gets equivalents from the SDK) | ADR 0005 | authored-now | |
| The two orthogonal gates: backend gate (`includeBaseTools`, composition-root-set) vs. role/package gate (`CapabilityFrame.allow/deny` via `canUseTool`) | ADR 0005 | authored-now | Per DC-5a: backend-awareness lives in composition/adapter, never in neutral handler code. |
| Bash ships unconfined beyond `cwd = worktreeRoot` — a named S-2 deviation (attended, local-first, no OS sandbox on pure-API) | ADR 0005 | authored-now | Explicit, maintainer-authorized deviation; must be stated as such, not hidden. |
| Tool schemas mirror Claude Code's exactly (ripgrep via `@vscode/ripgrep`, `tinyglobby`, node `child_process`) | SPEC M6 §base-tools | authored-now (Plan B) | |
| Write/Edit funnel through `emit` (producer ①, reuses the mutate spine) | ADR 0005 | authored-now | Ties to the P7/D81 change-event-spine invariant already in the Constitution. |
| Egress tools (WebSearch/WebFetch) credential-gated at the composition root, `parallel` only at that point in time | already-in-code (pointer) | authored-now | Superseded by the later web-tool-routing specs (see below) — record the historical "only parallel" fact but point at the shipped `packages/core/src/workbench/web/` for current truth. |
| Concrete module: `packages/core/src/workbench/base-tools.ts` | already-in-code (pointer) | authored-now | Verified present. |
| **Out of scope this increment: per-session worktree isolation + group-level tool allow-listing UX** | ROADMAP | residue-for-Phase-3 | Named explicitly in the doc's "Out of scope (this increment)" section; matches the `m6-status` memory's "Floored: ... per-session worktree." Still not built — a possibility, not a decision. |

## docs/superpowers/specs/2026-07-05-longcat-backend-adapter-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| LongCat 2.0 registered as a third `provider`, mirroring `@coa/adapter-deepseek` 1:1, via the same `complete()` + shared loop driver | ADR 0002 | authored-now | Verified: `packages/adapter-longcat/src/` has the same 8-file shape as `adapter-deepseek`. |
| No provider SDK (fetch only), no Anthropic-compat path, no streaming, no effort ladder (thinking on/off toggle only) | ADR 0002 | authored-now | Scope decisions for the LongCat adapter specifically — worth a line in the ADR's adapter-family table. |
| Credential-blind pointer model extends to LongCat (env-var / key-file, never inline secret) | ADR 0002 (cross-ref ADR 0006) | authored-now | Same posture as DeepSeek/auth. |
| Live-verified API facts (models endpoint path, cache-token field, tool-calling shape) | already-in-code (pointer) | authored-now | `packages/adapter-longcat/src/models.ts`, `wire.ts` — implementation detail, not durable design; pointer only. |
| Real default pricing for `LongCat-2.0` (in $0.75 / out $2.95 / cache $0.015 per 1M) | already-in-code (pointer) | authored-now | `packages/adapter-longcat/src/pricing.ts`. |

## docs/design/research/core-context-and-roles-spike.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| DC-1 — structure-first priority (structural levers over added prose) | ADR 0003 | authored-now | |
| DC-2 — the role model: role = prose section + capability refs, additive/stackable, union semantics | ADR 0003 | authored-now | |
| DC-3 — three runtime capability types: skill-Pieces, tool-groups, MCP servers | ADR 0003 | authored-now | |
| DC-4 — package/bundle demoted to a distribution/preset wrapper, not a runtime assembly layer | ADR 0003 | authored-now | |
| DC-5 / DC-5a — layer-on-native, two-mode render, composition never branches on backend (**reverses D-P1**) | ADR 0004 | authored-now | Its own ADR per G5 (small, standalone, states the supersession explicitly). |
| DC-6 — the ordered DC-6 prompt-layer slot skeleton | ADR 0003 | authored-now | Content-level skeleton (slot ids/order) also lives in shipped code — see `context-format-rewrite-design.md` row below. |
| DC-7 — project context split by volatility; AGENTS.md include toggle + fidelity ladder | ADR 0003 | authored-now | |
| DC-8 — skills model on-demand-capable, ship always-on first | ADR 0003 | authored-now | |
| DC-9 — the objective A/B verification approach (frozen task set, no LLM judge) | ADR 0003 | authored-now | |
| DC-10 — slot-ordering contract + snapshot tests; sanitize injected project context | ADR 0003 | authored-now | |
| DC-11 — no coa-added safety/refusal guardrails; `baseline-safety` Piece removed from the floor | ADR 0003 | authored-now | Cross-ref SC-1/ADR 0009 (the system's only two blocks). |
| DC-12 — maximal configurability; built-in ∪ user `.coa/` merge, drop-unknown/never-throw | ADR 0003 | authored-now | Cross-ref ADR 0008 (strict-superset / no-lock-in). |
| `registerMcp` port addition to `RuntimeAdapter` (open item, not yet built) | ROADMAP | residue-for-Phase-3 | Genuinely open — not yet shipped; a possibility, not a decision to record as done. |
| The reconciliation section (§7): D-P1's reopened config-leak risk, contained via explicit `settingSources`/`tools` at the M9 seam | ADR 0004 | authored-now | Load-bearing consequence of the D-P1 reversal — must appear in the ADR, not just the DC-5 line. |
| MCP reference level — role-level vs. agent/project-level MCP references (§4 open items) | OPEN — needs a home | residue-for-Phase-3 | Left open pending the schema pass; both are defensible, harnesses vary. See `## OPEN — needs a home` below. |
| In-app authoring/editing UI (build/edit roles, packages, Pieces — anything) | ROADMAP | residue-for-Phase-3 | Deferred by design (§4/DC-12); the `.coa/` built-in∪user merge schemas are built now specifically so this stays a data change later, not a code change. |

## docs/design/research/2026-07-03-context-format-rewrite-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| The DC-6 slot skeleton as a concrete, shared render helper (`renderSections`, `SLOTS`/`SlotId`) | ADR 0003 | authored-now | Design-level; the *why* goes in the ADR. |
| Structure lives in assembly, not Piece bodies; per-backend rendering stays in each adapter (DC-5a) | ADR 0003 + ADR 0004 | authored-now | |
| The decoupled model (§10b): baseline = universal-only; packages carry task conduct; roles carry only scope/boundary; `baseline-code-quality` deleted | ADR 0003 | authored-now | Supersedes §7 where they differ — author the ADR from §10b, not §7. |
| Claude drop-set (`PRESET_COVERED_PIECES`) = `{baseline-identity, baseline-tone, baseline-tool-use, baseline-environment}` | ADR 0004 | authored-now | Verify current `PRESET_COVERED_PIECES` contents against `render-native.ts` when authoring. |
| Concrete implementation: `packages/shared/src/render-sections.ts`, `packages/shared/src/slots.ts`, `packages/shared/src/piece.ts` (`slot` field) | already-in-code (pointer) | authored-now | Verified present: `render-sections.ts`, `render-sections.test.ts`, `slots.ts`, `slots.test.ts`, `piece.ts` all exist in `packages/shared/src/`. |

## docs/superpowers/specs/2026-07-03-owned-web-tools-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| For any non-Anthropic model, coa must own WebSearch/WebFetch execution (Anthropic's are server-side, non-portable) | ADR 0005 | authored-now | |
| Egress is a separate concern from file base-tools (own file, own precondition — S-4 egress seam, not `confinePath`); no change-events (no M1 spine involvement) | ADR 0005 | authored-now | |
| `SearchProvider` port (no-lock-in seam) + `Summarizer` port (WebFetch degrades to raw-markdown when absent, D85) | ADR 0005 | authored-now | |
| **Initial provider set: `parallel` (default), `exa`, `tavily`, `brave`** | ADR 0005 | authored-now | **SUPERSEDED by shipped code — see drift log.** Record this doc's original intent, then state the shipped set explicitly so the ADR doesn't perpetuate a stale provider list. |
| Concrete module: `packages/core/src/workbench/web-tools.ts` | already-in-code (pointer) | authored-now | Verified present. |
| **Deferred — full S-4 domain-policy governance (allow/deny lists, per-fetch robots.txt handling)** | ROADMAP | residue-for-Phase-3 | Verified still not built: `allowedDomains`/`blockedDomains` are agent-requested pass-through fields forwarded to the provider (`tavily.ts`, `parallel.ts`, `firecrawl.ts`), not a coa-enforced policy; no robots.txt handling anywhere in `packages/core/src/workbench/web/`. |
| **Deferred — WebSearch result caching** | ROADMAP | residue-for-Phase-3 | Not built; a possibility. |
| **Deferred — provider adapters beyond the one or two wired at launch** | ROADMAP | residue-for-Phase-3 | Cross-ref the drift log below: shipped set is `firecrawl`/`parallel`/`tavily`; `exa`/`brave` were never added — the increment-2 doc's own "Deferred (increment 3+)" list confirms this is a deliberate scope stop, not a bug. |
| **Deferred — a real cost-cap/deny on the egress seam (placed but floored)** | ROADMAP | residue-for-Phase-3 | Verified: `packages/core/src/session/daemon.ts` records the WebFetch summarizer's spend to the ledger (`governance.record({ scope: 'web_fetch_summarizer', ...usage })`) but the code's own comment states "Audited (ledger) but NOT charged to the M7 cost-cap this increment — a scoped deferral." No domain/egress-level deny exists anywhere in `web-tools.ts`. This is the governance seam this design explicitly "places... but leaves... as a documented floor." |

## docs/superpowers/specs/2026-07-03-web-tool-routing-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| Cooldown-aware multi-key routing: `ProviderOutcome` classified result, `KeyStateStore` (credential-blind, persisted circuit-breaker), `runChain` (generic router, reused by search later) | ADR 0005 | authored-now | Verified: `packages/core/src/workbench/web/key-state-store.ts`, presumed `routing.ts`/`limits.ts` per increment-2 doc — confirm exact filenames when authoring. |
| `FetchProvider` port; `firecrawl` (paid) + `plainFetch` (free floor, never returns `limit`) adapters | ADR 0005 | authored-now | Free-floor-as-always-last-hop is the D85 strict-superset instance for this feature. |
| WebFetch summarizer default = DeepSeek V4 flash via `@coa/loop-driver`'s `complete()`, config-driven model id | SPEC M6 §web-tools | authored-now (Plan B) | |
| Config shape (`web.fetch.providers`, `freeFloor`, `summarizer`, `quotaCooldown`) | SPEC M6 §web-tools | authored-now (Plan B) | Superseded in shape by increment 2 (adds `web.search`) — author from the union of both docs, not this one alone. |

## docs/superpowers/specs/2026-07-04-web-tool-routing-increment-2-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| Search-side routing added: `SearchProvider` becomes outcome-returning, reuses `runChain<T>` generically (fetch=`string`, search=`SearchHit[]`) | ADR 0005 | authored-now | |
| `tavily` (search+extract) and `firecrawl` (search) adapters added; shared per-provider limit classifiers (`firecrawlLimit`, `tavilyLimit`) for DRY | ADR 0005 | authored-now | Verified shipped: `packages/core/src/workbench/web/limits.ts` (`firecrawlLimit`/`tavilyLimit`), `tavily.ts`, `firecrawl.ts`. |
| Emergent property: one `KeyStateStore` shared across search+fetch, so one key's cooldown applies to both (account-level rate limits) | ADR 0005 | authored-now | |
| **Legacy `web.provider`/`web.credential` (single-key) config removed outright, replaced by `web.search.providers`** | ADR 0005 | authored-now | Pre-v1, no back-compat shim — worth stating so a future agent doesn't go looking for the old shape. |
| **Final shipped provider set: search = `tavily → firecrawl → parallel`; fetch = `firecrawl → tavily → (free floor)`** | ADR 0005 | authored-now | **This is the ground truth** — verified live in `packages/core/src/workbench/web/web-config-store.ts` (`SEARCH_KINDS`/`FETCH_KINDS`) and `web-config.ts`. See drift log below. |
| **Deferred — live remaining-credit introspection + proactive local quota accounting** | ROADMAP | residue-for-Phase-3 | Named three times (`2026-07-03-web-tool-routing-design.md`, this increment-2 doc, `2026-07-04-local-web-key-store-design.md`) and never built in any of them — one row for traceability across all three sources. |

## docs/superpowers/specs/2026-07-04-local-web-key-store-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| `~/.coa/web.yaml` (user-global, credential-blind) + `~/.coa/keys/web-<label>` secrets, mirroring the `accounts.yaml`/`AccountsRegistry` pattern | ADR 0005 | authored-now | Cross-ref ADR 0006 (same credential-blind-pointer posture as auth). |
| `WebConfigStore` (mirrors `AccountsRegistry`): `read`/`addCredential`/`removeCredential`/`write`, chain-validated kinds | ADR 0005 | authored-now | Verified shipped: `packages/core/src/workbench/web/web-config-store.ts`. |
| `coa websearch` / `coa webfetch` CLI twins of `coa auth`, split by chain | SPEC M6 §web-tools | authored-now (Plan B) | |
| Daemon loader: `buildSessionDeps` constructs `WebConfigStore(homedir())`, forwards to `createDaemonCore({web})` only when non-empty (D85: unconfigured ⇒ tools not offered) | SPEC M6 §web-tools | authored-now (Plan B) | |
| User-global only (no project `.coa/web.yaml`); priority = add order within a fixed provider order | ADR 0005 | authored-now | A YAGNI decision worth preserving as *why* the design is this shape. |

## docs/superpowers/specs/2026-06-30-multi-account-auth-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| Credential-blind subscription selection: coa stores pointers (`config-dir`, `ambient`), never secrets; the SDK resolves the token itself | ADR 0006 | authored-now | |
| The ambient-token trap: a non-ambient account overlay must also clear `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` **and** ambient OAuth-token vars (`CLAUDE_CODE_OAUTH_TOKEN`) so the selected login isn't silently overridden | ADR 0006 | authored-now | Load-bearing subtlety — a naive clear-only-API-key implementation would still leak. |
| `ant-profile` locator dropped post-spike (Console/API path, not subscription); `config-dir` + `ambient` are the only two locator types | ADR 0006 | authored-now | Verified: spike PASSED 2026-06-30 per memory; confirm current `providerSchema`/locator union in `packages/shared/src/auth.ts` matches (only two arms) when authoring. |
| `resolveAuthEnv(locator, baseEnv)` — the only SDK-specific, subscription-aware code, an env **overlay** (spread `process.env` first, then apply) | ADR 0006 | authored-now | |
| Strict-superset: no `~/.coa/accounts.yaml` or `active: ambient` ⇒ byte-identical to today (zero auth passed) | ADR 0006 | authored-now | |
| Per-account ledger attribution rides existing session-start metadata (no new event type) | SPEC M7 §ledger-attribution | authored-now (Plan B) | |
| `auth` core module: `list`/`getActive`/`add`/`remove`/`setActive` over `~/.coa/accounts.yaml` | ADR 0006 | authored-now | **Concrete module ships as `packages/core/src/auth/registry.ts`** (not the spec's unnamed "`auth` core module" — verified present, see drift log). |
| `coa auth` CLI + RPC verb surface (`listAccounts`/`currentAccount`/`addAccount`/`useAccount`/`removeAccount`) | SPEC M9 §auth-env-overlay | authored-now (Plan B) | |

## docs/superpowers/specs/2026-06-30-console-frontend-foundation-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| Stack: Electron+React (D114), design tokens as CSS custom properties (3-tier: primitive/semantic/component), Tailwind reading from tokens, custom in-repo component library, Radix headless primitives | ADR 0007 | authored-now | |
| Design principles P1–P12 + the 16 composition-craft principles (§5.1) | ADR 0007 | authored-now | The *why*; UI.md carries the structure-level restatement per G6. |
| Token scales (spacing, type, radius, z-index, motion durations/easing, color/OKLCH, contrast targets, theming/density) | UI.md (structure) + already-in-code (pointer for exact values) | authored-now | Exact values live in `console-ui/src/theme.css`/`tokens/semantic.ts` — pointed to, not copied, per G6. |
| Component families + intent contract (Foundations/Actions/Inputs/Layout/Data-display/Feedback/Overlays/Dense-Viz) incl. the `DenyNotice` single-deny-channel surface | ADR 0007 + ADR 0009 | authored-now | `DenyNotice` cross-refs SC-1 (ADR 0009) explicitly. |
| Motion/feedback contract (Carbon "productive" register, optimistic-UI-only-for-local-actions rule, container-query-first responsive) | UI.md | authored-now | Authoring rule, not a *why* — belongs in UI.md per G6, not the ADR body. |
| App-shell architecture: 3-layer seam (transport/bridge/view-model), secure Electron baseline (contextIsolation/sandbox/CSP), daemon peer-client auto-spawn model | ADR 0007 | authored-now | |
| Layout abstraction (P12): panel registry, versioned Zod `LayoutDescriptor`, imperative `LayoutEngine` port, `StaticEngine` MVP + `react-resizable-panels`, dockview as deferred upgrade | ADR 0007 | authored-now | Verified shipped: `packages/console-layout`. |
| Visual direction locked: warm-dark "forge/ledger", brass #c39a3e, shell direction B → later inspector-first refinement (§21.1) | ADR 0007 | authored-now | |
| The virtualization reversal's *precursor* decision (react-virtuoso for Transcript) — **later reversed**, see the chat-professionalization row below | ADR 0007 | authored-now | State as historical; the ADR's *current* truth is the reversal (non-virtualized, `content-visibility`). |
| Mock-first full shell posture (§12, §16 no-refactor guarantee); Plan 4a/4b/4c decomposition; `ConsoleState{data,ui,actions}` mechanism; layout persistence = Electron-main file, no daemon verb | ADR 0007 | authored-now | |
| Shell-chrome/responsive corrections (§22): floating-pane separation model, seamless title bar/no native menu, fixed-px nav region, themed scrollbars | UI.md (authoring rules) | authored-now | |
| §18 remaining tuning/scope items: light-theme exact values (tuned at build), bundled display typeface (system-font-only for now; at most one distinctive wordmark face, decided at build), Sigma.js graph-fallback threshold (~5k visible nodes) | ROADMAP | residue-for-Phase-3 | Minor tuning decisions explicitly deferred in the source's "Open decisions / deferred" section (§18); grouped as one row since none is independently architecture-durable. |
| Implementation conventions as-built (§23): 6-role type scale, density-driven control heights, feedback/motion contract, platform gotchas (Chromium scrollbar pseudo-elements, title-bar height lockstep) | UI.md (authoring rules) | authored-now | These are the "short authoring rules" G6 keeps in full in UI.md. |

## docs/superpowers/specs/2026-07-01-console-agents-surface-chat-rail-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| Agents is a nav-rail route (not a dock summary); supersedes the foundation spec's §21.3 4c-2 placement | ADR 0007 | authored-now | Record as a superseding decision so the ADR doesn't cite the old placement as current. |
| Local vs shared = Personal vs Project agents (`.coa/` committed vs user-level) | ADR 0007 | authored-now | |
| Agent identity system: 16-glyph Lucide vocabulary + 8 Okabe-Ito-anchored categorical swatches, excluding brass | ADR 0007 | authored-now | Brass-reservation rule ties to §5.1 #9 (60-30-10 already in the foundation doc). |
| One session switcher, selection-follows-session invariant (rail and switcher can never disagree) | ADR 0007 | authored-now | |
| Pinned agents = user-local UI preference on `ConsoleSettings`, never written into a Role | ADR 0007 | authored-now | |

## docs/superpowers/specs/2026-07-02-chat-interface-overhaul-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| The wire `TurnFrame` union already carries the full taxonomy (thinking/text/tool_use/tool_result/reconcile/error/permission/subagent/turn-boundary) — the console was dropping most of it | ADR 0007 | authored-now | A finding, not a decision, but durable context for why the taxonomy work happened. |
| Markdown via react-markdown + remark-gfm (no `dangerouslySetInnerHTML`); syntax highlighting via react-syntax-highlighter/hljs (A/B-decided over Shiki for bundle size) | ADR 0007 | authored-now | |
| Fira Code for mono/code surfaces only; chat prose stays sans (verified against the VS Code Claude Code extension) | ADR 0007 | authored-now | |
| Nesting via `parentTurn`/`depth`; approval cards are pure surfacing (SC-1); permission-mode toggle drives the SDK's native mode, not a coa cage | ADR 0007 + ADR 0009 | authored-now | |
| Phase 0/1/2 split: pure render first (no backend), then backend-backed (`getToolDetail`, `resolveRef`, `interruptSession`, live approvals, `status` Push) | ROADMAP | residue-for-Phase-3 | The backend-tail items not yet built are live possibilities, tracked as ROADMAP items, not an ADR decision. |

## docs/superpowers/specs/2026-07-03-chat-polish-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| Side dots become the single spine (gutter column, line + dot, breaks at user turns) | already-in-code (pointer) | authored-now | Pure render polish, superseded again by chat-professionalization's non-virtualized rework — record as historical iteration, point at current `Transcript.tsx`. |
| `foldToolFrames` — pairs `tool-use`+`tool-result` into one merged card by `handle` | ADR 0007 (pointer) | authored-now | **Still live in shipped code** — verified `useMemo(() => foldToolFrames(frames), [frames])` in `packages/console-ui/src/dense/Transcript.tsx`. Durable behavior, not superseded. |
| Status pill driven by the daemon's `status` push, not per-frame clearing (bug fix: `clearSending()` was firing on every push) | already-in-code (pointer) | authored-now | A correctness fix, worth one line so it isn't silently reintroduced. |

## docs/superpowers/specs/2026-07-04-chat-professionalization-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| **Architecture reversal: drop virtualization.** `GroupedVirtuoso` replaced with a plain scroll container rendering all frames + CSS `content-visibility:auto`, because full-transcript selection + Ctrl-F are incompatible with windowing | ADR 0007 | authored-now | **This is the current shipped truth** — verified no `react-virtuoso`/`GroupedVirtuoso` reference remains in `packages/console-ui/src/dense/Transcript.tsx` or its `package.json`. The ADR must state this as the live decision, not the earlier virtuoso choice. |
| Session-routing correctness bug: `onPush` must route by `sessionId` (was appending to whichever session was active, mis-routing live output on session switch) | already-in-code (pointer) | authored-now | A shipped correctness fix. |
| Per-tool registry (icon/verb/summary), tool-block design-gate process (3 showcase variants, reviewer picks) | ADR 0007 | authored-now | Ties directly into the two rich-tool-card specs below (the "reviewer picked rich card" outcome). |
| Non-goals carried forward: token-by-token streaming, compaction UI, timeline/rewind stay separate projects | ROADMAP | residue-for-Phase-3 | Forward-looking possibilities, not this-phase decisions. |

## docs/superpowers/specs/2026-07-05-rich-tool-card-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| The rich card promoted from showcase specimen to a real `console-ui` kit member (`ToolCard` + `ToolCard.intent.ts`) | ADR 0007 | authored-now | |
| Syntax highlighting per-line (not whole-text) via `SyntaxText`; byte-faithfulness holds because the highlighter only receives verbatim bytes (D128) | ADR 0007 | authored-now | Cross-ref the byte-faithful-render invariant already in the Constitution. |
| `PaneOverlay` — a pane-scoped (not window-portal) overlay for Expand, contained by construction | ADR 0007 | authored-now | |
| Scope decision: live wiring into the transcript is a separate follow-up (Phase 3 in that spec's own numbering, not this refactor's Phase 3) | (n/a — historical sequencing) | residue-for-Phase-3 | Already resolved by the follow-on spec below; no separate home needed beyond noting it was resolved. |

## docs/superpowers/specs/2026-07-05-rich-tool-card-live-and-enhancements-design.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| Reveal action: `code -g <abs-path>:<line>` in the main process, falling back to `shell.showItemInFolder` if `code` isn't on PATH | ADR 0007 | authored-now | |
| Path confinement: the reveal IPC resolves against the session worktree root and refuses any escape — never opens an arbitrary path | ADR 0007 | authored-now | Ties to the S-1 confinement precondition already governing file tools. |
| The rich `ToolCard` becomes the live transcript rendering (replacing the private card), `onOpenPath(path, line?)` as the shared seam for header links + search-match links | ADR 0007 | authored-now | |
| `run_checks` structured body (status chips); red error markers layered on the existing whole-body danger tint | ADR 0007 | authored-now | |
| PaneOverlay accessibility gap — `aria-modal` + initial focus/focus-trap deferred from the build phase (§B4) | ROADMAP | residue-for-Phase-3 | An accessibility-floor debt item (ties to ADR 0007/UI.md's accessibility-floor principle), not a design decision — flag so it isn't lost. |

## docs/superpowers/audits/console-perf.md
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| `optimizeDeps.include` missing in dev Vite config (cold-start regression) | ROADMAP | residue-for-Phase-3 | **Verified still open** — no `optimizeDeps` in `apps/desktop/electron.vite.config.ts`. |
| Tailwind `@source` scans all 157 `console-ui` files including tests | ROADMAP | residue-for-Phase-3 | **Verified still open** — `@source '../../../../packages/console-ui/src'` present verbatim in `apps/desktop/src/renderer/globals.css`. |
| 2s poll replaces entire state with no shallow-equality guard | ROADMAP | residue-for-Phase-3 | **Verified still open** — no `shallowEqual` in `apps/desktop/src/renderer/console.ts`. |
| `useMemo` missing on `groupByUserTurn(foldToolFrames(frames))` in `Transcript` | (fixed — no home needed) | residue-for-Phase-3 | **Verified FIXED** — `packages/console-ui/src/dense/Transcript.tsx` now wraps `foldToolFrames` in `useMemo` keyed on `frames`. Record as resolved so Phase 3 doesn't re-flag it. |
| Zero `React.memo`/`useCallback` across ~50 kit components | ROADMAP | residue-for-Phase-3 | **Verified partially fixed** — `memo` now used in `Transcript.tsx` and `apps/desktop/.../panels/ChatPanel.tsx` only; the broader kit still lacks it. |
| Layout persistence (`onLayout`) fires on every drag pixel, no debounce/throttle | ROADMAP | residue-for-Phase-3 | **Verified still open** — no `throttle`/`debounce` in `packages/console-layout/src/engine/static-engine.tsx`. |
| 7+ sequential IPC roundtrips on startup | ROADMAP | residue-for-Phase-3 | Not independently re-verified this pass (lower priority per the audit's own ranking); carry forward as an open item. |
| No Vite CSS dev-sourcemap tuning (`devSourcemap: false`) | ROADMAP | residue-for-Phase-3 | **Verified still open** — no `devSourcemap` setting in `apps/desktop/electron.vite.config.ts`. |
| **Context note:** the audit assumed a virtualized (`GroupedVirtuoso`) transcript; `chat-professionalization-design.md` (same-day, 2026-07-04) deliberately *removed* virtualization for full-text selection/Ctrl-F. Several of the audit's virtualization-adjacent framings (windowed re-mount costs) are now moot by design, not by fix. | (context only) | residue-for-Phase-3 | Flag this in the ROADMAP entry so a future reader doesn't think virtualization removal was a perf regression — it was a deliberate correctness trade covered by `content-visibility`. |

## docs/design/handoff/OPEN.md §0 (C1–C12)
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| C1 Structured turn-event Push (`TurnFrame` union, reliable+`seq`+gap-detectable) | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | §0 frames C1-C12 as "not yet built, owner sign-off needed." Reconcile against current code: some (e.g. the `TurnFrame` union itself, subagent frames) are now shipped per the chat specs above — OPEN.md's framing needs a status pass, not a re-decision. |
| C2 Subagent-stream linkage (`parentTurn` + lifecycle frames) | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | Overlaps chat-interface-overhaul's B5/CHAT-2 — likely now at least partially shipped; verify against `packages/shared/src/push.ts` before rewriting OPEN.md. |
| C3 Approval round-trip (`respondApproval`, enriched `approval` payload) | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | Chat specs show approval cards as still mock/inert as of 2026-07-04 — likely still genuinely open. |
| C4 `getToolDetail(handle)` | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | Rich-tool-card-live spec explicitly marks this out of scope/deferred as of 2026-07-05 — still open. |
| C5 `resolveRef(ref, worktree?)` | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | Superseded in the reveal mechanism by the rich-tool-card-live IPC (`coa.openPath`) for the path-click case specifically; `resolveRef` as a general M8 read verb may still be open — verify. |
| C6 Investigate-from-flag seeded session | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | No evidence in the read specs that this shipped — treat as still open. |
| C7 Agent-config read+write (`listRoles`/`getRole`/`writeRole`) | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | Chat-rail spec (2026-07-01) explicitly defers real CON-1 verbs — still open. |
| C8 Conversation compaction | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | Explicitly deferred as a separate project by every chat spec read — still open. |
| C9 Enumerate the full M8 JSON-RPC catalogue | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | Partially true already (many verbs named in the specs above exist) — needs a real enumeration pass against `packages/core` to close, not a memory/report check. |
| C10 Session control + status (`interruptSession`/`steerSession`, `status` Push) | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | `status` Push is confirmed shipped (chat-polish spec, verified `console.ts` status handling); `interruptSession`/`steerSession` still deferred per every chat spec — partially built. |
| C11 Authoritative reconciliation frame (`reconcile`) | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | Every chat spec explicitly states `reconcile` "stays dropped (deferred)" — still open. |
| C12 View-scoped live deltas (`subscribeView`/`unsubscribeView`) | ROADMAP/OPEN reconciliation | residue-for-Phase-3 | No evidence of this shipping in the read specs — still open. |

## docs/design/research/pieces-phase-claude-code-baseline.md
Reference only, no durable decision to graduate. It is a research spike verified against installed SDK types
(`@anthropic-ai/claude-agent-sdk@0.3.196`) whose findings were fully absorbed and in most cases superseded by
`core-context-and-roles-spike.md` (DC-1..DC-12) and `2026-07-03-context-format-rewrite-design.md`. No content here
lacks a home elsewhere; its role was to inform, not to decide. Safe to delete once ADR 0002/0003/0004 are
authored from the docs that supersede it. **Status: residue-for-Phase-3** (deletion only, no transcription).

## docs/design/research/harness-system-prompt-claude-code.md
Reference only, no durable decision to graduate. A live capture of the Claude Code system prompt used as
primary-source grounding for the baseline brief above. No design decision originates here; it is raw evidence.
**Status: residue-for-Phase-3** (deletion only, no transcription).

---

## Drifts verified against current code (recorded so they are not re-introduced)

1. **Web providers.** Every owned-web-tools-era doc (`2026-07-03-owned-web-tools-design.md`) names an initial
   set of `parallel/exa/tavily/brave`. The **shipped** set, verified live in
   `packages/core/src/workbench/web/web-config-store.ts` (`SEARCH_KINDS = ['tavily','firecrawl','parallel']`,
   `FETCH_KINDS = ['firecrawl','tavily']`) and `web-config.ts`, is **`firecrawl` / `parallel` / `tavily`** — no
   `exa`, no `brave`. Grep run (verbatim):
   ```
   rg -n "parallel|firecrawl|tavily|exa|brave" packages/core/src/workbench/web/ | rg "'"
   ```
   Result: every match is `firecrawl`, `parallel`, or `tavily` (search/test/adapter files) — zero occurrences of
   `exa` or `brave` anywhere in `packages/core/src/workbench/web/`. ADR-0005 must state the shipped set as fact
   and record `exa`/`brave` as an abandoned early direction, not a live provider.

2. **D-P1 reversed in shipped code.** `pieces-and-dual-backend-spec.md`'s D-P1 ("keep the custom-string path,
   do NOT use `preset:'claude_code'`") is **reversed** in `packages/adapter-claude-sdk/src/sdk-options.ts`, which
   now builds `{ type: 'preset', preset: 'claude_code', append }`. Grep run (verbatim):
   ```
   rg -n "preset|claude_code" packages/adapter-claude-sdk/src/sdk-options.ts
   ```
   Result (line numbers from the live file): line 81-82 comment "coa LAYERS its rendered prompt ON the
   `claude_code` preset rather than replacing it"; lines 89-90 `type: 'preset'` / `preset: 'claude_code'`; line
   100 comment reiterating the layering rationale. This confirms `core-context-and-roles-spike.md`'s DC-5 is the
   live truth; ADR-0004 must record the D-P1→DC-5 supersession explicitly, and no ADR/SPEC text should claim coa
   "owns the entire prompt" on Claude.

3. **Auth core module naming.** `2026-06-30-multi-account-auth-design.md` refers to it generically as "an `auth`
   core module" (`packages/core/src/auth/`) without pinning a filename. The shipped module is
   `packages/core/src/auth/registry.ts` (+ `registry.test.ts`) — verified present via `ls`. ADR-0006 should cite
   the concrete path.

4. **Console virtualization reversed twice, net result = no virtualization.** The foundation spec
   (2026-06-30) picked `react-virtuoso` for the Transcript; `chat-interface-overhaul-design.md` (2026-07-02) and
   `chat-polish-design.md` (2026-07-03) built on top of it; `chat-professionalization-design.md` (2026-07-04)
   **explicitly reverses** this to a non-virtualized, `content-visibility:auto` transcript for full-text
   selection + Ctrl-F. Verified: no `react-virtuoso` or `GroupedVirtuoso` reference remains in
   `packages/console-ui/src/dense/Transcript.tsx` or its `package.json`. ADR-0007 must state the non-virtualized
   model as the current architecture and record the virtualization choice as a superseded intermediate step, not
   omit it entirely (the *why* — full-selection/Ctrl-F requirements beat windowing — is durable and worth
   keeping).

5. **`console-perf.md` fix status (verified this session, see the audit's own table above for the grep-by-grep
   detail):** `optimizeDeps.include` — still missing. Tailwind `@source` full-kit scan — still present verbatim.
   Poll shallow-equality guard — still missing. `useMemo` on transcript grouping — **now fixed** (verified in
   `Transcript.tsx`). `React.memo` on heavy panels — **partially fixed** (`Transcript.tsx`, `ChatPanel.tsx` only).
   Layout-persistence debounce — still missing. `devSourcemap: false` — still missing. Startup IPC-roundtrip
   count — not re-verified this pass.

---

## OPEN — needs a home

Found during a completeness fix pass (2026-07-06): three sub-questions, each explicitly labeled OPEN or
unresolved by its own source doc, that DC-12/ADR assignments do not actually settle. None invents a home —
each is flagged here instead, per the legend rule ("never invent a home").

| Durable question | Raised in | Why still open | Cross-ref |
| --- | --- | --- | --- |
| **D-P3** — where the baseline Piece set physically lives (built-in package vs. seeded `.coa/` bundle) | `pieces-and-dual-backend-spec.md` Part A1/§F (marked OPEN); reaffirmed still-open in `core-context-and-roles-spike.md` §4 | DC-12 (ADR 0003) settled the *general* built-in∪user-`.coa/` merge mechanism, not this specific placement call; no maintainer decision or shipped-code answer found. | ADR 0003 (DC-12) — record as an explicit open sub-question when authoring, not a settled fact. |
| MCP reference level — role-level vs. agent/project-level MCP references | `core-context-and-roles-spike.md` §4 | Left open pending the schema pass; both are defensible, harnesses vary; no code answers it. | ADR 0003 (DC-3) — the third capability type; this is an unsettled placement detail within it. |
| Tool-description minimalism — how far to lean on Claude's training priors vs. ship full descriptions for every tool | `pieces-and-dual-backend-spec.md` Part F | One neutral tool-description set must serve a prior-rich backend (Claude) and a prior-free one (DeepSeek/LongCat); no measurement or decision resolves the trade-off yet. | ADR 0005 (owned tools) — note as an open tuning question, not resolved policy. |

## Appendix A coverage

Cross-checked against `docs/superpowers/specs/2026-07-05-coa-dedrift-refactor-design.md` Appendix A (7 bullets).
Every bullet has at least one manifest row.

| Appendix A bullet | Covered by (manifest sections) | Status |
| --- | --- | --- |
| Multi-backend architecture | `dual-backend-integration.md`, `pieces-and-dual-backend-spec.md`, `2026-07-05-longcat-backend-adapter-design.md`, `pure-api-base-tools.md` sections above → ADR 0002 + SPEC M9/M6 + already-in-code pointers | COVERED |
| DC-1..DC-12 | `core-context-and-roles-spike.md`, `2026-07-03-context-format-rewrite-design.md` sections above → ADR 0003 (+ DC-5 → ADR 0004) | COVERED |
| Owned web tools + local key store | `2026-07-03-owned-web-tools-design.md`, `2026-07-03-web-tool-routing-design.md`, `2026-07-04-web-tool-routing-increment-2-design.md`, `2026-07-04-local-web-key-store-design.md` sections above → ADR 0005 + SPEC M6 | COVERED |
| Multi-account auth | `2026-06-30-multi-account-auth-design.md` section above → ADR 0006 + SPEC M9/M7 | COVERED |
| Console design system + reversals | `2026-06-30-console-frontend-foundation-design.md`, `2026-07-01-console-agents-surface-chat-rail-design.md`, `2026-07-02-chat-interface-overhaul-design.md`, `2026-07-03-chat-polish-design.md`, `2026-07-04-chat-professionalization-design.md`, `2026-07-05-rich-tool-card-design.md`, `2026-07-05-rich-tool-card-live-and-enhancements-design.md` sections above → ADR 0007 + UI.md (+ ADR 0009 cross-refs for `DenyNotice`/approval surfacing) | COVERED |
| OPEN.md §0 C1–C12 (now built) | `docs/design/handoff/OPEN.md §0 (C1–C12)` section above → ROADMAP/OPEN status reconciliation | COVERED (note: several C-items are only *partially* built per the verification notes in that section — the reconciliation itself, not this manifest, resolves the exact per-item status) |
| `audits/console-perf.md` | `docs/superpowers/audits/console-perf.md` section above → ROADMAP (possibilities), with per-item fix status verified against current code | COVERED |

**Result: 7/7 Appendix-A bullets covered.** Every bullet's durable decisions map to a live home; the three
`## OPEN — needs a home` entries above are sub-questions *within* already-covered bullets (D-P3 within
multi-backend/DC-12, MCP reference level within DC-3, tool-description minimalism within owned web tools) —
they don't represent an uncovered Appendix-A bullet, just an honestly-flagged unresolved detail inside one.
The two reference-only baseline docs required no home (justified deletion, not omission).

---

_Last reviewed: 2026-07-06_
