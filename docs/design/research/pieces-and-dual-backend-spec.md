# Spec skeleton — the pieces phase + the dual-backend adapter (coupled)

**Status:** SPEC SKELETON (draft). Graduates to `docs/design/handoff/` (SPEC.md extension or a new module
spec) once ratified. No code yet.
**Couples:** giving governed agents a real system prompt + tools + context (**the pieces phase**) *and*
making that work across the Claude Agent SDK backend and a clean-API backend (**the dual-backend adapter**).
They are one body of work: the **neutral Piece set + neutral tool set are authored once and consumed by both
backends**; the backends diverge only at the M9 seam and in who owns the tool-call loop.
**Feeds from:** [pieces-phase-claude-code-baseline.md](pieces-phase-claude-code-baseline.md) (the map) +
[dual-backend-integration.md](dual-backend-integration.md) (the architecture).
_Last reviewed: 2026-07-02._

---

## 0. Framing

### 0.1 Problem
Today a governed session runs on an essentially empty scaffold: `renderNative` emits a minimal
custom-string `systemPrompt`, `denyBuiltins` denies only `Edit`, `deliverReminder`/`render_context` are
floor no-ops, and the agent inherits whatever the SDK defaults give it (baseline brief §5–6). The agent has
no coa-authored identity, tool-use guidance, safety posture, or environment framing — and the target repo's
config leaks in uncontrolled. Meanwhile the clean-API backend can't run at all: a pure model has no prompt,
no tools, no context, no loop.

### 0.2 Why coupled
The behaviors the Claude custom-string path deletes are the **same** behaviors a pure model never had. So
coa authors **one neutral baseline** — a Piece set (prompt scaffold) + a tool set (schemas + descriptions +
executors) — and both backends consume it: the Claude adapter registers/renders it (plus a parity package to
re-declare what the preset would have carried), and the clean-API adapter *is* that baseline plus a
coa-owned loop. Building these separately would duplicate the neutral core twice.

### 0.3 Scope
- **In:** the neutral baseline (Part A); Claude-side hardening + parity + reminders (Part B); the clean-API
  thin adapter + loop driver (Part C); the shared seam it all rides (Part D, already built); the invariants
  that must hold on both (Part E).
- **Out / deferred:** the public semver'd SPI (D110); Tier-B classifier enablement (D107); subagent nesting
  beyond depth-1 (D122); prompt-cache tuning on the clean API; live-DeepSeek credential UX beyond a floor.

### 0.4 Non-negotiables inherited
TypeScript strict / no-any · determinism-first (no model call on a critical path) · the two-and-only-two
SC-1 blocks (M3 close-gate + M7 cap) · strict-superset (feature off ⇒ ≤ raw loop) · no-lock-in (M9 the one
seam) · the M1 change-event spine is the only shared mutable substrate.

---

## Part A — The neutral baseline (backend-shared)

### A1. The baseline Piece set (the prompt scaffold)
The coa-authored, backend-neutral Pieces that shape agent behavior. Authored once; the Claude parity
package and the clean-API adapter both consume them.

- **Content (from baseline brief §4.1 "(a)" rows):** a coa-neutral **identity/role** line (NOT "Claude
  Code"); a **safety/refusal** posture; **tool-use policy** for the exact exposed tools (prefer dedicated
  tools, batch independent calls, don't retry denied calls verbatim); minimal **code-quality** guidance
  (match surrounding style, comments = why); a **coa-authored environment block** (worktree, platform,
  model, date — from the *session*, never the operator's box).
- **Owned decisions:**
  - **D-P1 — keep the custom-string path.** Do NOT switch the Claude adapter to `preset:'claude_code'`. coa
    authors its own authority; renting Anthropic's defeats the governance model.
  - **D-P2 — cache-friendly ordering.** Volatile env content goes last (or into the first user message),
    preserving `renderNative`'s byte-stable-prefix / P1 cache invariant.
  - **D-P3 — one source, two consumers.** The Piece set is the parity package's payload *and* the clean-API
    scaffold. (Where it physically lives — a built-in package vs `.coa/` — is **OPEN**, §F.)
- **Interface sketch:** these are ordinary `Piece`s (M0), so they flow through `M5.compile → NeutralConfig →
  M9.renderNative` unchanged. The novelty is *authoring* them, not a new type.

### A2. The neutral tool set (schemas + descriptions + executors)
- **The kept set (baseline brief §2.1 core):** `Read`, `Glob`, `Grep` (read), `edit_symbol`/`apply_patch`
  (governed Mutate), `Bash` (governed), optionally `WebFetch`/`WebSearch` (governed egress). M6's catalogue
  already provides the governed structure-level tools + executors.
- **Descriptions are coa-authored** (lean), so they transfer to any backend. On Claude, coa additionally
  *keeps the built-ins* it doesn't replace (Read/Glob/Grep/Bash) and relies on baked descriptions +
  training priors; on the clean API coa must ship a description for **every** tool (no priors).
- **Owned decisions:**
  - **D-T1 — lean on Claude's training via canonical names.** Where coa keeps a built-in, keep its canonical
    name; where coa governs one, consider `toolAliases` (`{Bash:'mcp__coa__bash'}`) so the model emits the
    canonical name but the call routes to the governed tool. (Priors don't attach to `mcp__coa__*` names.)
  - **D-T2 — Edit is NOT denied by default.** Reverse today's `denyBuiltins(['Edit'])`. `Edit`
    (targeted, prior-backed, token-cheap) ≈ coa's `edit_symbol`; integrity is guaranteed by the reconciler,
    not by denying the tool. Demotion becomes a *measured* knob decided by the v0 spike, not a default.
    (Note the inconsistency to resolve: whole-file `Write` is the token-expensive one and is *not* denied.)
  - **D-T3 — kernel vs on-demand (D100).** Only the kernel tool set is always-loaded; the rest via the
    `find_tools`/`load_tool` MCP proxy. Same partition informs the clean-API driver's tool-list budget.
- **Interface:** unchanged — M6 `RegisteredTool` (name/description/partition/Zod schema/invoke). The
  clean-API driver consumes the same `RegisteredTool[]`; it just executes `invoke` itself instead of via MCP.

### A3. Context injection
- `M4.ContextPackage` → delivered via `render_context` (M8 calls it at session start; floor = folded into the
  rendered prompt). On the clean API the driver injects it as message content. No new decision — this is the
  existing C3 direction; the pieces phase just starts populating it (M4 L-ASM is spike-gated, so floor first).

### A4. `assemblePieces` — the entry point
- Today a floor returning empty pieces (⇒ vanilla compile). This spec fills it: `assemblePieces(sessionCtx)
  -> Piece[]` = the baseline set (A1) + role/scope Pieces + any M4-derived context Pieces. Called in
  `createSession` before `M5.compile` (unchanged call site). **Backend-agnostic** — its output feeds
  `compile → renderNative` on Claude and the scaffold builder on the clean API.

---

## Part B — Claude Agent SDK backend (fat adapter + parity)

### B1. Close the config leak (baseline brief §6)
Make the tool/context surface explicit in `buildBaseOptions`:
- `settingSources: []` (isolation) unless coa deliberately wants a source; make the re-anchor `.claude`
  load intentional rather than default-inherited.
- `tools`: an explicit allow-list (allow-list posture, not deny-list).
- `strictMcpConfig: true` so only coa's `coa` MCP server is present.
- **Rationale:** the target repo's `CLAUDE.md`/settings + `~/.claude` must not become un-authored authority
  (breaks D108). Small, independent, high-value — do first.

### B2. The parity package
- **What:** an auto-included package that re-declares the A1 Piece set (+ any Claude-specific framing) into
  coa's governance model, so the removed-by-custom-string behaviors exist and "can't be removed."
- **Mechanism (OPEN, §F):** auto-inclusion path — a built-in bundle M5 always compiles in, vs a seeded
  `.coa/` bundle. Prefer built-in (can't be deleted; matches "can't be removed").
- **Note:** the parity package carries *prompt behaviors*, not tools — tools are A2 / M6.

### B3. Light up `deliverReminder`
- Wire the floor no-op to `PostToolUse`/`UserPromptSubmit` `additionalContext` (D108/D133). Channel is
  reserved; M3 decides *which* rule/when, M9 delivers. Enables reactive enrichment even for un-governed
  built-in edits (so keeping `Edit`, D-T2, loses nothing on governance).

### B4. Leverage training (cross-ref D-T1)
Canonical tool names + optional `toolAliases`; do not prefix-mangle the tools Claude is fluent with.

---

## Part C — Clean-API backend (thin adapter + loop driver)

### C1. The `complete()` primitive (the lower-level port)
```
complete(messages, tools) -> { text, toolCalls: ToolCall[], usage: RuntimeUsage }
```
- Pure model I/O — one round-trip, no loop. The **only** backend-specific surface a new pure API must
  implement. Behind the M9 port family (a new capability port, or a sub-port of the adapter).
- Maps the provider's chat-completions request/response to neutral shapes; no coa types leak provider-ward.

### C2. The coa loop driver (owns the ReAct loop) — **the key decision**
Runs the loop the SDK runs for Claude:
1. build messages (A1 scaffold + A3 context + conversation),
2. `complete(messages, tools)`,
3. for each returned tool call → run the **`canUseTool` predicate** (cost-cap + M3 deny) → if allowed,
   **execute the governed M6 tool** (emits the change-event, producer ①) → append the result,
4. loop until the model stops → run the **close-gate** (`M3.gate()`); if blocked, inject the message and
   continue,
5. map every step to `TurnFrame`s; report `usage` to `onSettle`.
- **D-L1 (OPEN, recommend SHARED) — one reusable loop driver vs one loop per adapter.** Recommend a **single
  shared driver** so (a) adding a pure API stays trivial (implement `complete()` only) and (b) the
  governance-critical loop lives in one audited place. Alternative: a minimal loop inside each thin adapter
  (more duplication, more places for a governance bug).
- **Consequence:** coa executes *every* tool → total visibility; producer ① covers all edits directly, the
  reconciler still backstops shell-style writes. Governance is *tighter* than on Claude.

### C3. The DeepSeek `RuntimeAdapter`
- Model I/O via `complete()`; credentials/auth wiring; a **faithful DeepSeek reasoning mirror** (generalize
  `ModelSelection.reasoning` to a provider-discriminated union); a `provider:'deepseek'` case in
  `createAdapter`; a `fetchModels` route for its model list.
- Treat DeepSeek as a **cheap test backend**, not a fidelity reference (tool-call format quirks, no/weak
  prompt caching).

### C4. Cost
- No `total_cost_usd` from a raw API → a **price table** (per-model in/out token price) computes cost from
  `usage` → `onSettle → M7.charge`. The cap works identically.

### C5. Console
- Model/reasoning picker fed by the provider's model list (capability system already built); reasoning
  options gated to the selected model's supported levels.

---

## Part D — The shared seam (already built; stated for completeness)
The M9 `RuntimeAdapter` port (D109), the D121 neutral `SessionAdapterInit`, the `TurnFrame`/`Push`
vocabulary + `string | AsyncIterable<string>` input, capability profiles + null-fallback, and the
provider-keyed `createAdapter` registry **already exist** ([[deepseek-adapter-direction]], [[m8-status]]).
This spec adds no new seam — it fills the ports with real content and adds the `complete()` primitive + loop
driver behind the same port family. See [dual-backend-integration.md](dual-backend-integration.md).

---

## Part E — Invariants across both backends
Each is one core decision reached through a different injection point:

| Invariant | Claude (SDK) | Clean API (driver) |
| --- | --- | --- |
| Per-tool block (cap + M3 deny) | `canUseTool` hook | driver checks predicate inline |
| Close-gate (SC-1) | `Stop` hook → `{decision:'block',reason}` | driver checks `M3.gate()` before turn end |
| Change spine (D81) | producer ① (MCP Mutate) + ② reconciler for built-ins | producer ① (coa executes all) + ② backstop |
| Cost cap (M7) | `ResultMessage` → `onSettle` | price table × usage → `onSettle` |
| Authority (D108) | systemPrompt + `additionalContext` | systemPrompt + stream injection |

---

## Build order (topological)
1. **A1 baseline Pieces + A2 tool descriptions** — shared, unblocks everything.
2. **B1 config hardening** — small, independent, closes the leak.
3. **A4 `assemblePieces` wiring** + render on Claude — the pieces phase proper; Claude gets real
   prompt/tools/context. **Validate at the v0 calibration gate** (a green successful turn — still pending).
4. **B3 `deliverReminder`** + **B2 parity package** — complete the Claude authority story.
5. **C1 `complete()` + C2 loop driver** — the clean-API foundation; **testable against a MOCK completion
   backend** (scripted tool calls) with no live creds — proves the governed loop + TurnFrame mapping in CI.
6. **C3 DeepSeek adapter + C4 cost + C5 picker** — go live; validate against real DeepSeek (not CI).

Steps 1–4 are the pieces phase (Claude-first). Steps 5–6 are the clean-API path. Step 5 de-risks the one
open design (loop ownership) with no external dependency.

---

## Part F — Open decisions & risks
- **D-L1 loop ownership** — shared driver vs per-adapter (recommend shared). Decide at step 5.
- **D-P3 / B2 where the baseline lives** — built-in package vs seeded `.coa/` (recommend built-in for
  "can't be removed").
- **D-T2 Edit/Write demotion policy** — measure at the v0 spike; resolve the Edit-denied/Write-allowed
  inconsistency.
- **Tool-description minimalism** — how far to lean on Claude priors vs. full descriptions (the DeepSeek
  path forces full; Claude can be lean). One neutral set must serve both.
- **DeepSeek specifics** — tool-call format quirks, prompt-cache absence, credential UX.
- **Calibration dependency** — the v0 spike (green turn) is still unproven on Claude (rate-limit, not a
  defect); it gates step 3's validation.

---

## Sources
[pieces-phase-claude-code-baseline.md](pieces-phase-claude-code-baseline.md),
[dual-backend-integration.md](dual-backend-integration.md), [SPEC.md](../handoff/SPEC.md) (M4/M5/M6/M9 +
D81/D99/D100/D108/D109/D117/D121). Memory: [[pieces-phase-baseline]], [[deepseek-adapter-direction]],
[[m9-status]], [[m8-status]], [[m6-status]], [[m5-status]], [[m4-status]].
