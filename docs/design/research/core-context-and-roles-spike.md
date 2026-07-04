# Core context & role composition — spike findings + decisions

**Status:** RESEARCH + DECISIONS (draft). Authoritative for the *direction*; not a line-by-line impl spec.
An implementation spec/plan follows once the model is validated in code.
**Owns:** what coa's always-on core context contains, how it is formatted and ordered, how a *role* composes
capabilities, how all of that renders across backends, and how coa will verify the core actually helps.
**Feeds from:** [pieces-phase-claude-code-baseline.md](pieces-phase-claude-code-baseline.md) +
[pieces-and-dual-backend-spec.md](pieces-and-dual-backend-spec.md) +
[dual-backend-integration.md](dual-backend-integration.md).
**Revises:** the prior **D-P1** stance in `pieces-and-dual-backend-spec.md` (see §7).
_Last reviewed: 2026-07-03._

---

## 0. Framing

"Harnessing an agent" — its system prompt + the context it is fed — is roughly half of agent effectiveness.
coa governs a rented loop, so the one lever it fully owns before the model runs is **how it assembles the
prompt**. This spike answers four questions the maintainer set:

1. What is the most effective way to convey each piece of context to the agent (grounded in how the best
   open *and* closed harnesses do it), especially on the less-configurable API route?
2. How do we keep the core context system as **adapter-agnostic** as possible?
3. Fix the role picker's "None" affordance (a UI bug — separate impl task).
4. Support **multiple roles per agent**, and make roles actually *do* something.

Method: a four-lane research spike (leaked/published system prompts · open-source harness assembly code ·
vendor guidance + empirical/academic research · eval/benchmark evidence + a verification approach), then a
maintainer decision round. This doc records the findings and the settled decisions.

### 0.1 Non-negotiables inherited
TypeScript strict / no-any · determinism-first (no model call on a critical path) · the two-and-only-two SC-1
blocks (M3 close-gate + M7 cap) · strict-superset (feature off ⇒ ≤ raw loop) · no-lock-in (M9 is the one
backend seam) · the M1 change-event spine is the only shared mutable substrate · compose-don't-reinvent (P8).

---

## 1. What the evidence says (spike synthesis)

Four independent lanes converged hard. Findings are tagged **[strong]** (controlled/empirical), **[vendor]**
(Anthropic/OpenAI guidance), **[harness]** (observed in a real system prompt or its assembly code).

### 1.1 The single most important finding — structure beats prose, and more prose can *hurt*
The large, clean, *same-model* wins in the literature all came from **structure**, not identity/safety wording:

- Aider changed only the **edit-format contract** in the system prompt (SEARCH/REPLACE → unified diff) and
  GPT-4 Turbo went **20% → 61%** on its refactor benchmark. **[strong]**
  ([unified diffs](https://aider.chat/docs/unified-diffs.html))
- Anthropic's SWE-bench work moved Claude 3.5 Sonnet **33.4% → 49.0%** mostly by refining **tool
  descriptions**; they "spent more time optimizing tools than the overall prompt." **[strong]/[vendor]**
  ([SWE-bench Sonnet](https://www.anthropic.com/research/swe-bench-sonnet),
  [writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents))
- SWE-agent's biggest single win was a **windowed file viewer that *removed* raw context** — letting the model
  `cat` whole files collapsed performance (~4× worse without the ACI). More raw context actively hurt.
  **[strong]** ([SWE-agent](https://arxiv.org/abs/2405.15793))
- Holding the *model fixed* and varying only the scaffold produces **10–48 point** swings on SWE-bench
  Verified — large enough to reorder leaderboards. **[strong]**
  ([harness-disclosure paper](https://arxiv.org/pdf/2605.23950))
- Instruction-following **degrades as instruction density rises** (~68% adherence at 500 instructions; the
  failure mode is *omission*, biased toward dropping *later* instructions). More prose ≠ more adherence.
  **[strong]** ([IFScale](https://arxiv.org/abs/2507.11538))

**Implication:** coa's defensible lever is the *structural* prompt it owns — tool declarations/descriptions,
output-format contracts, and how project/spec/symbol context is *shaped and bounded* — not adding more
identity/safety prose. Because coa layers **on top of** a native preset, its main empirical risk is additive
bloat/duplication. Verification (§5) must guard against exactly that.

### 1.2 The convergent skeleton (order)
Across Claude Code, Cursor, Windsurf, Devin, Cline, Roo, plus primacy/recency + cache evidence, the ordering
converges to:

> identity (1 sentence) → tone/conciseness → tool-use **conduct** → code-change discipline → safety/governance
> → **role section(s)** → **project/repo context** → **volatile tail (one labeled block, LAST)**

- **[strong]** "Lost in the middle": models overweight the start (primacy) and end (recency), underweight the
  middle. Put the most important always-on rules **early**; put volatile/task content **last**.
  ([Liu et al.](https://arxiv.org/pdf/2307.03172))
- **[harness]** Claude Code / Cursor put the volatile `<env>` / `<user_info>` block at the very end — exactly
  the cache-friendly, stable-prefix ordering. Windsurf (early env) is the minority and worse for caching.
- **Role-before-project is correct** (confirming the maintainer's instinct): role sections are behavioral
  *instructions*; project context is *data the instructions operate on*, so it sits later. Roo puts
  `roleDefinition` first and repo/env context last.

### 1.3 Cache-warmth vs recency dissolves by content class
The apparent tension (stable-first for prompt caching vs important-last for recency) is not a real conflict —
they act on **different content**:

- Stable, high-authority rules (core scaffold, the *stable* half of role sections): **first** → primacy AND
  cache warmth align. **[vendor]**
- Volatile content (env, date, retrieved context, the task): **last**, after the cache breakpoint → recency
  AND cache correctness align. **[vendor]** (Anthropic cache mechanics: any byte change invalidates
  everything after it.)
- goose rounds its injected timestamp **to the hour** to avoid busting the cached tail — a concrete trick coa
  should adopt, extending the existing frozen-prompt/cache-warmth work.
- For late-position emphasis without breaking cache, prefer a mid-conversation `role:"system"` message over
  duplicating a rule into the tail. **[vendor]**

### 1.4 Format
- **One portable format**, not a per-backend prose renderer: **Markdown section headers** for the body, **XML
  tags only to fence embedded payloads** (repo files, `<env>`, retrieved chunks, examples). This is the
  intersection of Anthropic's and OpenAI's current guidance ("delineation matters, exact syntax is becoming
  less important") and degrades gracefully on DeepSeek/GPT. **[vendor]**
- **Tool *definitions* stay backend-neutral; only their *serialization* varies** (native JSON schema on
  tool-native models; taught XML-in-prose on bare models). This is the M9 seam expressed at the prompt layer,
  and every modular harness (Cline especially) does it. **[harness]**

### 1.5 Persona prompting is not a free win
"You are an expert engineer" **measurably hurts** factual/reasoning accuracy (e.g. MMLU 71.6% → 68.0%) and is
highly sensitive to irrelevant detail. Personas reshape *style/depth*, not capability. **[strong]**
([Principled Personas](https://arxiv.org/pdf/2508.19764)). So coa roles should scope **concrete behavior +
tool-use framing**, keeping persona minimal and relevant — which is exactly the "role = tools + prompt
section" model, not a persona bolt-on.

### 1.6 The harnesses' composition model (how skills/tools/MCPs relate to roles)
No harness collapses capabilities into one generic "package." They keep **three distinct reference types** and
a **role/mode selects among them**:

| Harness | Prose knowledge (skills) | Tools | MCP servers | Role/mode |
|---|---|---|---|---|
| Roo | custom instructions | **tool *groups*** gated per mode | global, merged in | **mode = roleDefinition + tool-groups** |
| Cline | `.clinerules` / rules | dual-serialized defs | **own MCP section** | variant = ordered components |
| goose | recipes → prompt extras | tool list | **"extensions" = MCP** | mode + recipe |
| OpenHands | **micro-agents/skills** (triggered) | tools | separate | agent + micro-agent |
| Continue | **rules** (globs/`alwaysApply`) | tools | MCP → tools | mode + rules |
| Claude Agent SDK | **Skills** (SKILL.md, on-demand body) | allow/deny | separate | subagents; **plugins** bundle all |

A *bundle* legitimately exists only for **distribution** (Claude Code **plugins**, goose **extensions** ship
skills+tools+MCP together) — but at runtime they decompose into the three types. coa already has that seam
(the versioned `BundleManifest` / `importBundle`, TAX-8).

---

## 2. Decisions

Decision IDs are `DC-n` (design-context) so later docs/commits can cite them.

### DC-1 — Structure-first priority
coa's prompt effort prioritizes the **structural** levers it owns — tool declarations/descriptions,
output-format contracts, and bounded context-shaping — over added identity/safety prose. Every Piece added to
the always-on core is treated as an **adherence cost** to justify against verification (§5), not a free add.
_Rationale: §1.1._

### DC-2 — The role model
A **role** = a coa-authored **prose section** (identity/conduct scoped to the role) + references to the
capabilities it needs: **skill-Pieces**, **tool-groups**, and **MCP servers**. Roles are **additive and
stackable**:
- No role selected ⇒ nothing added (the permissive baseline floor — unchanged).
- Multiple roles ⇒ **union** of their prose sections + capabilities (deduped).

This supersedes today's `Role = { packageIds, pieces? }` where the two starter roles carried no prose and so
appeared inert. _Rationale: §1.5, §1.6; matches Roo's proven `mode = roleDefinition + tool-groups`._

### DC-3 — Capability composition: three runtime types
The reusable capability primitives are **three distinct types**, referenced by a role (Roo/Cline model):
1. **Skill-Pieces** — reusable *prose* knowledge/behavior units (coa `Piece`s). May be **always-on (push)** or
   **on-demand (reminder/triggered)** via the existing Piece delivery axis (see DC-8).
2. **Tool-groups** — named sets of tool grants (individual tools remain referenced by name; deduped at
   assembly). The CapabilityFrame is built from these.
3. **MCP servers** — references to external servers that self-describe their tools at connection; coa does not
   author their prose.

_Rationale: §1.6 — this is what every harness actually does; "tool-group" alone was too narrow because skills
and MCPs are not tools._

### DC-4 — "Package/bundle" is distribution, not a runtime assembly layer
The generic `AgentPackage` bundle is **demoted** from a mandatory runtime middle layer to an **optional
distribution/preset wrapper** (coa's existing `BundleManifest` / `importBundle`). At runtime a role references
the three types of DC-3 directly. Bundles exist only to *ship/share* a set of capabilities together (like a
plugin); on import they decompose into skill-Pieces + tool-groups + MCP refs. _Rationale: §1.6._

### DC-5 — Backend stance: layer on native, two-mode render, quarantined
coa **layers** its core on top of each backend's native preset rather than replacing it (revises D-P1, §7).
"Adapter-agnostic" means **works well everywhere**, not byte-identical — Claude may legitimately run richer
than DeepSeek. The render is **two-mode**:
- **Delta on Claude** — decline to *re-emit* the handful of **baseline-conduct Pieces** the Claude preset
  already ships (identity boilerplate, conciseness rules, task-mgmt, tool-usage policy, `file:line`, git
  safety, `<env>`). This is a **gentle non-duplication, not suppression** — coa never strips native behavior.
- **Standalone on bare models** (DeepSeek/raw API) — emit the *full* scaffold, including a **taught
  tool-calling convention**, because nothing else provides it.

**Invariant (DC-5a):** the composition layer is **backend-neutral and must never branch on backend.** It emits
neutral intent (Pieces + CapabilityFrame + MCP refs). *Every* backend-aware choice — the delta vs standalone
Piece selection, tool serialization (JSON vs XML), MCP wiring — lives in **M9 `renderNative`**. This is what
keeps composition adapter-agnostic and is why DC-2/DC-3 and DC-5 compose cleanly.

**Scope of the delta:** only the coa **baseline-conduct** Pieces get the delta treatment. Role prose, project
context, and skill-Pieces are coa-unique and are emitted on **both** backends unchanged. _Rationale: §1.1,
§1.4._

### DC-6 — Prompt layer order
The assembled prompt is an **ordered, named-slot registry** (Cline/Roo model), rendered in this order:

1. identity (1 sentence, names the governance role)
2. tone / conciseness
3. tool-use **conduct** (stable) — *distinct from the tool catalog*
4. code-change discipline
5. coa governance *orientation* — informational only (what coa is: determinism / cost-cap / help-never-cage).
   **No refusal or harmful-content guardrails** (DC-11)
6. **role section(s)** (stable)
7. **static project context** — the AGENTS.md include toggle (DC-7); relatively stable per project
8. **volatile tail (LAST, one labeled block)** — dynamic project context (repo map / retrieved snippets),
   the task, and the env block (platform/date/cwd), hour-rounded for cache warmth

Slots 1–6 form the cache-warm stable prefix; slot 8 is the only genuinely volatile region. _Rationale: §1.2,
§1.3._

### DC-7 — Project context: split by volatility, fidelity ladder
Project context is its own middle concern, split by volatility and following coa's no-lock-in floor:
- **Static project facts** (the **AGENTS.md include toggle** — the "one checkbox" starting point) sit in the
  system prompt right after the role sections (slot 7).
- **Dynamic/retrieved context** (repo map, retrieved snippets, the current task) rides the **volatile tail /
  user turn** for recency + cache-safety (slot 8).
- **Fidelity ladder:** AGENTS.md include is the neutral floor now; the later upgrade is an **Aider-style
  tree-sitter *ranked* repo map** (personalized-PageRank over the symbol graph, token-budgeted) — coa already
  ships tree-sitter (M4), so this auto-engages where a grammar exists.

_Rationale: §1.1 (bounded context beats raw dumps), §1.2, §1.3._

### DC-8 — Skills model on-demand, ship always-on first
The composition model is designed so skill-Pieces **can** be on-demand/triggered (progressive disclosure, the
Piece delivery axis), but **this effort ships always-on (push) skills first** and defers the
trigger/retrieval machinery. _Rationale: keep scope bounded; §1.1 says on-demand matters, but always-on is the
correct first increment._

### DC-9 — Verification approach (a standing check)
coa adopts a **lightweight, objective A/B** to answer "does the core help vs. hurt, net of cost?":
- **Task set:** a *frozen* 20–30 tasks with **hidden tests** (SWE-bench Lite/Verified subset + a few private
  self-authored fixtures to resist contamination). Pass = tests go green — no LLM judge.
- **Arms:** `coa raw` (native preset only) vs `coa core-on`; optional third arm toggling just the
  project/role layer to localize the effect.
- **Metric:** resolve rate **and** the M7 ledger's **cost/token delta** (a +1% resolve at +40% tokens is a net
  loss). Run **k=3–5** repeats/task (temperature variance dominates); report mean ± spread.
- **Cost:** ~30 tasks × 2 arms × 3 runs ≈ a few dollars / an overnight run.
- **No LLM-as-judge** for the headline (position/verbosity/self-enhancement bias — a coa backend grading coa's
  own output is disqualifyingly flattering). Reserve pairwise+order-swapped+cross-family+blind judging only for
  untestable qualitative claims. _Rationale: §1.1; judge-bias evidence
  ([Bias in the Loop](https://arxiv.org/html/2604.16790v1))._

### DC-10 — Safeguards (from harnesses that learned the hard way)
- **Slot-ordering contract + snapshot tests** over the *assembled* prompt per role-combination × backend, so
  additive composition can't silently reorder or drop a governance-critical slot. Cline pins this with
  integration snapshot tests.
- **Sanitize injected project context** (AGENTS.md, repo files) before it enters the governed prompt (strip
  control/unicode-tag injection vectors) — goose does this; a natural fit for coa's governance mandate and its
  typed-boundary constitution.

### DC-11 — No coa-added safety/refusal guardrails in the assembled context
coa's context assembly **must not add model-behavior guardrails** (refusal posture, "don't answer harmful
prompts", etc.). Rationale: they duplicate the model's trained safety, are pure adherence-tax tokens (DC-1),
and — most importantly — coa does **not** govern *how* a user uses their agent. The system's only two blocks
are the M3 close-gate and the M7 cost-cap (SC-1); the prompt layer adds none.

- **Removed from the always-on floor:** the current `baseline-safety` Piece
  ([baseline-pieces.ts](../../../packages/core/src/session/baseline-pieces.ts)) — drop it from
  `baselineStablePieces`. The coa baseline-conduct set becomes **identity · tone · tool-use · code-quality**
  (no safety Piece).
- **Operational-security hygiene is allowed but opt-in, not floor.** A narrow "don't echo secrets / env keys"
  Piece may live in the removable **`core` package** (default-on, excludable) — it's security hygiene for the
  *work product*, not a guardrail on the user. It is never in the mandatory baseline scaffold.
- This is a *removal*, so it also serves DC-1 (fewer tokens, less instruction dilution).

### DC-12 — Maximal configurability, no lock-in
The whole assembly is designed to be **user-overridable and authorable in principle** — the core Piece set,
roles, tool-groups, MCP refs, slot ordering, and project-context toggles are all *data*, not hardcoded policy.
Nothing locks the user in; consistent with the constitution's **no-lock-in** + **strict-superset (D85)** (any
feature off degrades to the raw loop; `coa raw` always shows the unfiltered loop).

- **Data-model implication (build this now, even before the editing UI):** every registry (roles, packages,
  tool-groups, the core Pieces) must **merge built-in defaults with user `.coa/` definitions**, with user
  definitions able to **add or override** built-ins (drop-unknown at the edge, never throw — SC-1). Authoring
  a role/package then becomes a *data* change, not a code change.
- **Deferred feature — in-app authoring:** a UI to **build and edit roles, packages, Pieces — pretty much
  anything** — is out of scope for this effort but must not be designed out. The schemas + `.coa/` merge above
  are what keep that door open.
- The single non-removable thing is the always-on baseline floor, and even *it* is a strict superset of the
  raw loop (D85), so "no lock-in" holds end to end.

---

## 3. The `#3` and `#4` implementation items (near-term, separate build)

These are the concrete UI/wiring fixes the decisions enable; they are impl tasks, not part of this doc's
research, and land after the model above is reflected in the schemas.

- **#3 — role picker "None".** Label the sentinel as **"None"** (not "None (baseline floor)") and ensure
  selecting it shows "None", not a "Select…" placeholder. Today the `Select` in
  [AgentsPanel.tsx](../../../apps/desktop/src/renderer/panels/AgentsPanel.tsx) uses `NO_ROLE = ''`; the empty
  string collides with the placeholder affordance. (UI bug.)
- **#4 — multiple roles + roles that bite.** `AgentSummary.role: string` becomes a **list** (DC-2 union
  semantics); roles gain a real **prose section** (DC-2) so they stop being inert. The resolver
  ([assemble-agent.ts](../../../packages/core/src/session/assemble-agent.ts)) unions role sections +
  capabilities and dedupes.

---

## 4. Open items (for the post-validation SPEC pass)

- **Reconcile with `pieces-and-dual-backend-spec.md`** — this spike revises D-P1 (§7); the SPEC skeleton's
  Part B "parity package" framing (re-declare what the preset would have carried) must be re-cast as the
  *gentle delta* of DC-5, and the config-leak risk (§7) resolved.
- **How far the Claude delta goes** — the exact set of baseline-conduct Pieces to skip on Claude is an
  empirical call; DC-9's A/B is the instrument to tune it.
- **Repo-map upgrade** (DC-7 fidelity ladder) — scope/trigger left to a later effort.
- **On-demand skill delivery** (DC-8) — the trigger/retrieval machinery.
- **MCP reference level** — role-level vs agent/project-level MCP references (both are defensible; harnesses
  vary). Left open pending the schema pass.
- **Add a `registerMcp` port to `RuntimeAdapter`** (see §6) — MCP is a first-class capability type in the new
  role model (DC-3) but is not yet a first-class *adapter* method (only `registerTools` exists). Each backend
  wires it differently (Claude SDK native MCP config vs coa's in-process MCP for bare backends).
- **Where the core Piece set physically lives** — built-in vs `.coa/` (inherited OPEN from the prior spec §F).
- **In-app authoring/editing UI** (DC-12) — build/edit roles, packages, Pieces, anything — deferred; the
  schemas + `.coa/` built-in∪user merge must be built now so it stays a data change, not a code change.

---

## 6. How this renders onto the existing M9 seam

The interface-with-per-backend-adapters this design needs **already exists** — it is the M9 `RuntimeAdapter`
([runtime-adapter.ts](../../../packages/spi/src/runtime-adapter.ts)), implemented once per backend
([adapter-claude-sdk](../../../packages/adapter-claude-sdk/src/claude-sdk-adapter.ts) ·
[adapter-deepseek](../../../packages/adapter-deepseek/src/adapter.ts)). Its methods (`registerTools`,
`renderNative`, `denyBuiltins`, `deliverReminder`, `cache_control`, …) are exactly the "register tool / render
native / …" surface. Three layers, only the last of which is backend-aware — this is DC-5a made concrete:

| Layer | Backend-aware? | Home | Concern |
|---|---|---|---|
| **Compose** | ❌ neutral | M8 `assembleAgent` | **add role**, select skill-Pieces / tool-groups / MCP → neutral Pieces + CapabilityFrame + MCP refs |
| **Compile** | ❌ neutral | M5 `compile` | Pieces + frame → `NeutralConfig` |
| **Render / wire** | ✅ per-backend | **M9 `RuntimeAdapter`** | `registerTools`, `renderNative`, `registerMcp`, `cache_control`, `denyBuiltins` |

Consequences for this design:
- **The two-mode delta (DC-5) lives in `renderNative`, and *only* there.** The Claude adapter's `renderNative`
  drops the baseline-conduct Pieces the preset covers; the DeepSeek adapter's keeps them + teaches the
  tool-calling convention. The adapters differ nowhere else.
- **`addRole` / compile stay neutral** — they must *never* be moved behind the backend interface (DC-5a).
- **`registerMcp` is the one worthwhile addition** to the port (§4 open items), formalizing DC-3's third
  capability type as a first-class adapter method.
- **Do NOT give the *compiler* per-backend adapters.** That is the tempting mistake this section exists to
  prevent: it would push a backend branch one layer too early and break composition's adapter-agnosticism.

---

## 7. Reconciliation with prior research (the D-P1 reversal) {#reconciliation}

The prior [pieces-and-dual-backend-spec.md](pieces-and-dual-backend-spec.md) **D-P1** decided to *keep the
custom-string path and NOT use `preset:'claude_code'`* — i.e. **coa owns the entire prompt** and rents none of
Anthropic's authority. This spike's **DC-5 reverses that**: coa **layers on** the native preset.

Consequences to carry forward honestly:
- **Reopened config-leak risk.** Leaning on the SDK preset is precisely what let the target repo's config
  (unset `settingSources`/`tools`) leak into governed sessions (flagged in the pieces-phase baseline). DC-5
  trades full prompt ownership for less duplication + less work; the leak must be contained another way
  (explicit `settingSources`/`tools` control at the M9 seam), not by prompt ownership.
- **Softened parity claim.** "Provably adapter-agnostic" is intentionally relaxed to "works well everywhere";
  Claude runs on preset+delta, bare models on the standalone scaffold. DC-9 measures whether that gap is
  acceptable rather than assuming byte-identical behavior.

This is a deliberate maintainer decision (structure-first, layer-don't-fight), recorded here so the SPEC pass
reconciles rather than silently diverges.

---

_Last reviewed: 2026-07-03._
