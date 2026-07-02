# Overview — one core, two backends (Claude Agent SDK + clean API)

**Companion to:** [pieces-phase-claude-code-baseline.md](pieces-phase-claude-code-baseline.md).
**Purpose:** how the *same* backend-blind core drives both the fat Claude Agent SDK backend and a thin
pure-API backend (DeepSeek and any chat-completions model) through the single M9 seam.
**Status:** design overview (synthesis of locked decisions + the one open piece, the pure-API loop). No code.
_Last reviewed: 2026-07-02._

---

## 1. The principle: one core, one seam, two adapters

Everything from M0–M8 is **backend-blind**. It produces neutral artifacts — a `NeutralConfig` (M5), a
`ContextPackage` (M4), a governed tool catalogue (M6), governance decisions (M3/M7) — and drives sessions
(M8), **never naming a backend**. The only place a backend exists is behind the **M9 `RuntimeAdapter` port**
(D109). The core calls capability ports; a missing capability returns a **null-fallback**, never a
`if (backend === …)` branch. Two adapters implement that one port:

- **`ClaudeSdkAdapter` (fat)** — Claude Code natively bundles the agentic loop, tools, prompt caching,
  hooks, subagents, and an OS sandbox. coa mostly *configures and governs* what's already there.
- **`DeepSeekAdapter` / any clean-API adapter (thin)** — a pure model has **nothing** native. coa *supplies*
  the loop, the tools, the prompt scaffold, and the context. The adapter is little more than model I/O.

The whole design goal: **the thin adapter is easy to add** (model I/O only), because coa already owns the
scaffolding; **the fat adapter is the outlier** that needs a parity package to fold Claude's native
behaviors into coa's governance model.

```
                         ┌──────────────────────────────────────────┐
                         │        BACKEND-BLIND CORE (M0–M8)          │
                         │                                            │
   M4 ContextPackage ─┐  │  M8 createSession(req, deps):              │
   M5 NeutralConfig  ─┼─▶│    assemblePieces → M5.compile             │
   M6 ToolCatalogue  ─┤  │    → M7.sandboxPolicy → sessionBudget      │
   M3/M7 governance  ─┘  │    → createAdapter(SessionAdapterInit)     │  ← neutral seam (D121)
                         │    → renderNative → denyBuiltins           │     no SDK types cross here
                         │    → registerTools → interceptTool         │
                         │    → interceptStop → runLoop               │
                         └───────────────────┬────────────────────────┘
                                             │  RuntimeAdapter port (M9 / D109)
                          createAdapter switches on ModelSelection.provider
                        ┌────────────────────┴─────────────────────┐
                        ▼                                           ▼
          ┌──────────────────────────┐              ┌──────────────────────────────┐
          │  ClaudeSdkAdapter (FAT)   │              │  DeepSeekAdapter (THIN)        │
          │  runLoop → query()        │              │  runLoop → coa-owned loop      │
          │  SDK owns: loop, tools,   │              │  coa owns: loop driver, tool   │
          │   hooks, cache, subagents │              │   exec, prompt, context        │
          │  coa: renderNative(str),  │              │  adapter = complete(msgs,tools)│
          │   MCP tools, deny, 2 hooks│              │   → {text, toolCalls, usage}   │
          │  + PARITY PACKAGE         │              │  + coa supplies EVERYTHING     │
          └────────────┬─────────────┘              └───────────────┬────────────────┘
                       │                                            │
                       └──────────────►  TurnFrame / Push  ◄────────┘
                                        (M0 push.ts — the one output vocabulary)
                                        input: string | AsyncIterable<string>
```

---

## 2. The two boundaries that make it work

**(a) The capability port (D109) — compile-time.** The core depends only on `spi` port *type signatures*
(`runLoop`, `registerTools`, `denyBuiltins`, `interceptTool`, `interceptStop`, `renderNative`,
`render_context`/`inject_runtime`/`cache_control`, `usageTelemetry`, `capabilityProfile`, `refs`,
`runEval`, `deliverReminder`). Each has a defined null-fallback. Neither adapter's concrete types are
visible to the core.

**(b) The neutral construction seam (D121) — runtime.** M8 builds a **`SessionAdapterInit`** with *only*
neutral types: `sessionId`, `sandbox` (CapabilitySet), `input: string | AsyncIterable<string>`,
`onTurn: (TurnFrame) => void`, `model: ModelSelection`, `onSettle`, `maxBudgetUsd`, `locator`, `resume`.
The **app-side composition root** (`apps/cli`) maps this to whichever concrete adapter it constructs. This
is why **no SDK type ever reaches the core** — the Claude adapter's own `ClaudeSdkAdapterInit` and its
SDK↔neutral mapping (`messageToFrames`, `toSdkPrompt`) live entirely inside `packages/adapter-claude-sdk`.

**(c) The neutral vocabulary — the wire.** Output is always `TurnFrame`/`Push` (M0 `push.ts`); input is
always `string | AsyncIterable<string>`. Each adapter maps its native format to/from these. The console and
CLI consume `TurnFrame`s **identically** regardless of backend — that's the payoff.

**(d) Provider routing.** `createAdapter(init)` switches on `init.model?.provider` (`'claude'` →
`ClaudeSdkAdapter`; `'deepseek'` → its adapter; unknown → an SC-1 error frame). `ModelSelection`
carries `{ provider, model, reasoning }` with a **faithful per-provider reasoning mirror** (Claude's is the
`ClaudeReasoning` 1:1 mirror of the SDK `thinking`/`effort`; DeepSeek adds its own).

---

## 3. The elegance: the `createSession` sequence is identical for both backends

M8's `createSession` calls the **same port methods in the same order** no matter the backend. Everything
that differs lives *inside* the adapter's implementation of those methods:

| Port call (same for both) | ClaudeSdkAdapter (fat) | Thin clean-API adapter |
| --- | --- | --- |
| `renderNative(neutralConfig)` | → SDK `Options` (custom-string `systemPrompt`, allow/deny lists, `.claude` files) | → a raw system-prompt string + the tool-schema list its loop driver will send |
| `denyBuiltins()` | disallow built-in `Edit` (demotable) | **no-op** — no built-ins exist |
| `registerTools(catalogue)` | wrap M6 tools as an in-process `coa` MCP server (`mcp__coa__*`) | **store** the tools; the loop driver executes them directly |
| `interceptTool(canUseTool)` | wire the SDK `canUseTool` hook | **store** the predicate; the loop driver calls it before each tool call |
| `interceptStop(stopPredicate)` | wire the SDK `Stop` hook | **store** it; the loop driver calls `M3.gate()` before ending a turn |
| `render_context(pkg)` / `deliverReminder` | `additionalContext` via hooks / systemPrompt (floor today) | inject into the message stream the loop driver builds |
| `runLoop(sessionConfig)` | `for await (query({prompt, options}))` — **SDK owns the loop** | **coa's loop driver owns the loop** (§5) |
| `usageTelemetry()` / `onSettle` | from the SDK `ResultMessage` | from each completion's `usage` |

So the core stays *one* code path. Adding DeepSeek means writing one adapter class, not touching M8.

---

## 4. What each backend natively provides vs. what coa supplies

| Concern | Claude Agent SDK (native) | Clean API (coa must supply) |
| --- | --- | --- |
| **Agentic loop** | `query()` owns it | **coa loop driver owns it** (§5, open) |
| **Tools** | built-ins (Read/Bash/Edit/Grep/…) + MCP | coa defines *every* tool (schema + description) and **executes** them |
| **System prompt** | `claude_code` preset available (coa uses custom string instead) | coa authors the full scaffold from Pieces |
| **Tool-use fluency** | baked into weights for canonical names | **absent** — descriptions must carry the weight |
| **Context injection** | CLAUDE.md/settingSources + dynamic sections | coa injects `ContextPackage` as message content |
| **Prompt caching** | native, automatic | provider-dependent; often weak/absent |
| **Per-tool block** | `canUseTool` hook | coa loop driver checks the predicate |
| **Close-gate** | `Stop` hook | coa loop driver checks `M3.gate()` |
| **Reminders** | `additionalContext` via hooks | coa injects into the message stream |
| **OS sandbox** | bubblewrap/Seatbelt (advisory on Windows) | none — S-1 confinement + attended operation only |
| **Subagents** | native `Task` tool | coa spawns child sessions itself (D122) |
| **Cost/usage** | `ResultMessage.total_cost_usd` | computed from token usage × price table |

The **parity package** (Claude side) re-declares as coa-governed Pieces the *behaviors* the custom-string
path removed (role/safety/tool-use guidance/env) — see the baseline brief §4. The **same neutral Piece set**
is what the thin adapter injects, so it's built once and consumed by both (baseline brief §7).

---

## 5. The one real asymmetry: who owns the tool-call loop (OPEN)

This is the crux and the only genuinely unbuilt design.

- **Claude:** coa hands the prompt + tools to `query()` and consumes the message stream. The SDK runs the
  full ReAct loop (model → tool_use → tool_result → repeat → stop), firing `canUseTool` and `Stop` for us.
  coa never sees the raw completion round-trip.

- **Clean API:** there is no loop. coa must run it. The likely shape (per [[deepseek-adapter-direction]]):
  a lower-level port primitive
  ```
  complete(messages, tools) -> { text, toolCalls, usage }
  ```
  plus a **coa-side loop driver** that:
  1. builds the message list (system scaffold + injected context + conversation),
  2. calls `complete(...)`,
  3. for each returned tool call → runs the **`canUseTool` predicate** (cost-cap + M3 deny) → if allowed,
     **executes the governed M6 tool** (which emits the change-event, producer ①) → appends the result,
  4. loops until the model stops, then runs the **close-gate** (`M3.gate()`); if blocked, injects the
     message and continues,
  5. maps every step to `TurnFrame`s and reports `usage` to `onSettle`.

  Two implementation options: a shared lower-level primitive + a reusable coa loop driver (so every future
  pure API reuses the driver), or a minimal loop inside each thin adapter. **Recommendation:** the shared
  driver — it keeps the "adding a pure API is trivial" promise and puts the governance-critical loop in one
  audited place. Decide in the DeepSeek spec, not here.

Note the nice consequence: on the clean-API path **coa executes every tool itself**, so it has *total*
visibility — producer ① covers all edits directly, and the reconciler (producer ②) still backstops anything
a shell-style tool writes. The governance story is actually *tighter* than on Claude, where built-in writes
must be caught after the fact.

---

## 6. How the governance invariants hold on both

The two SC-1 blocks and the change spine are backend-independent by construction:

- **Per-tool block (cost-cap + M3 deny):** same M8-assembled predicate; Claude fires it via `canUseTool`,
  the driver calls it inline. Same decision, different trigger point.
- **Close-gate (the other SC-1 block):** same `M3.gate()`; Claude via the `Stop` hook returning
  `{decision:'block', reason}`, the driver by checking before it ends the turn.
- **Change spine (D81):** producer ① (M6 Mutate) emits on every governed write on *both* backends; producer
  ② (the git reconciler) backstops non-coa writes (built-ins on Claude; shell tools anywhere).
- **Cost cap (M7):** `onSettle → M7.charge` on both; the driver charges per completion, Claude per result.
- **Authority delivery (D108):** system-prompt at start on both; mid-session reminders via `additionalContext`
  (Claude hooks) or stream injection (driver) — non-spoofable because *coa* authors them either way.

Every one of these is **the same core decision** reached through a different physical injection point — which
is exactly what the M9 port is for.

---

## 7. Capability profiles + graceful degradation

Each adapter advertises a `CapabilityProfile` (`capabilityProfile()`), read by M8 at `createSession` to pick
null-fallbacks. The **barebones baseline** is the guaranteed floor. Examples of the core degrading rather
than branching:

- `refs(symbol)` → Claude may (eventually) return tsserver refs; DeepSeek returns `null` → the caller
  falls back to M2's tree-sitter floor.
- `cache_control` / `render_context` mid-loop → no-op on a backend that lacks them; context still ships via
  the rendered prompt.
- `runEval` → rejects until the secondary path is wired, on any backend.

The core never asks "which backend?" — it asks "does this capability exist?" and takes the defined fallback.

---

## 8. What the clean-API path needs before it can run (feeds the DeepSeek spec)

1. The neutral **baseline Piece set** (role/safety/tool-use/env) — shared with the Claude parity package.
2. The neutral **tool set** — coa-defined schemas + descriptions + executors (reuse M6's governed tools).
3. The **`complete()` primitive** + the **loop driver** (§5) — the one unbuilt piece.
4. A **DeepSeek `RuntimeAdapter`** wiring model I/O + auth/credentials + its faithful reasoning mirror +
   a `provider:'deepseek'` case in `createAdapter` + its entry in `fetchModels`.
5. A **price table** for cost (no `total_cost_usd` from a raw API) → `onSettle`.
6. Console model/reasoning picker fed by the provider's model list.

Items 1–2 are the pieces phase (also needed for Claude); 3–6 are the DeepSeek spec. The routing seam
(registry + `ModelSelection` + capability system) already exists ([[deepseek-adapter-direction]]).

---

## Sources

coa: [SPEC.md §M9/D109/D117/D121](../handoff/SPEC.md), the M9 adapter
([claude-sdk-adapter.ts](../../../packages/adapter-claude-sdk/src/claude-sdk-adapter.ts)), the neutral seam
+ session flow ([session.ts / session-handlers.ts]), the routing factory
([adapter-factory.ts](../../../apps/cli/src/adapter-factory.ts)). Memory:
[[deepseek-adapter-direction]], [[m8-status]], [[m9-status]], [[m6-status]], [[pieces-phase-baseline]].
