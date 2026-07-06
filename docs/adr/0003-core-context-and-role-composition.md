# 0003. Core-context and role composition

- Status: accepted
- Date: 2026-07-06

## Context and problem

coa governs a rented agent loop; the one lever it fully owns before the model runs is how it assembles the
system prompt and how a *role* composes the capabilities layered onto that prompt. Before this decision, roles
were an inert `{ packageIds, pieces? }` shape with no prose section, prompt content had no fixed slot order, and
an always-on `baseline-safety` Piece duplicated the model's trained refusal behavior. A four-lane research spike
(leaked/published system prompts, open-source harness code, vendor guidance, eval evidence) produced twelve
numbered decisions (DC-1..DC-12); this ADR is their durable home, except **DC-5** (layer-on-native / never-branch-
on-backend), which belongs to a later ADR 0004 — DC-5 is a backend-rendering stance, not a context/role-
composition one, and is out of scope here.

## Decision drivers

- **Structure beats prose, and more prose can hurt.** Aider's edit-format-only change moved GPT-4 Turbo
  20%→61% on its refactor benchmark ([unified diffs](https://aider.chat/docs/unified-diffs.html)); Anthropic's
  SWE-bench work moved Claude 3.5 Sonnet 33.4%→49.0% mostly by refining tool descriptions
  ([SWE-bench Sonnet](https://www.anthropic.com/research/swe-bench-sonnet)); instruction-following degrades as
  instruction density rises, biased toward dropping later instructions
  ([IFScale](https://arxiv.org/abs/2507.11538)). Every added always-on Piece is an adherence cost to justify.
- **Primacy/recency + cache mechanics converge on one order.** Stable, high-authority content first (primacy +
  cache warmth); volatile content last (recency + cache correctness) — the model fixed, only the scaffold
  varied, still swings 10–48 points on SWE-bench Verified ([harness-disclosure](https://arxiv.org/pdf/2605.23950)).
- **coa does not govern *how* a user uses their agent** — only the two SC-1 blocks (M3 close-gate, M7 cost-cap)
  are blocks; a coa-added refusal/safety Piece would be an undeclared third one.
- **No-lock-in / max configurability** is a repo constitution invariant, not optional polish — every registry
  in this model must be user-overridable data, not hardcoded policy.

## Considered options

1. **Keep roles as opaque package bags, add prose ad hoc per role** (status quo). Rejected: roles carried no
   prose and appeared inert; nothing forced a role to *do* anything beyond a tool grant.
2. **One flat capability type ("tool-groups") for everything a role can reference.** Rejected: skills (prose)
   and MCP servers (self-describing external tool sets) aren't tools; collapsing them loses the distinction
   every real harness (Roo/Cline) keeps.
3. **Adopt the twelve-decision model from the spike** (chosen): a fixed slot skeleton, a role = prose + typed
   capability references (additive/stackable), package demoted to a distribution wrapper, project context split
   by volatility, no coa-added safety prose, and an objective A/B as the standing check rather than vibes.

## Decision

### Role model and capability composition (DC-2, DC-3, DC-4)
A **role** = a coa-authored **prose section** + references to the capabilities it needs, drawn from three
distinct runtime types (not one undifferentiated "tool-group"):
1. **Skill-Pieces** — reusable prose knowledge/behavior units (coa `Piece`s), push or on-demand via the
   existing delivery axis.
2. **Tool-groups** — named sets of individual tool grants, deduped at assembly into the `CapabilityFrame`.
3. **MCP servers** — references to external servers that self-describe their own tools; coa authors no prose
   for them.

Roles are **additive and stackable**: no role selected adds nothing (the permissive baseline floor, unchanged);
multiple roles union their prose sections and capabilities, deduped. This supersedes the earlier inert
`Role = { packageIds, pieces? }`. The generic `AgentPackage`/`BundleManifest` bundle is demoted from a mandatory
runtime middle layer to an **optional distribution wrapper** — it exists to ship/share a set of capabilities
together, decomposing into the three runtime types at import/resolution rather than staying an opaque unit a
role has to reference wholesale.

**Shipped:** `packages/shared/src/agent.ts`'s `roleSchema` carries `description` + `pieces` (the role's own
prose) alongside `packageIds`; `assemble-agent.ts`'s `assembleAgent`/`createRegistryAssemblePieces` accept
`roles: readonly Role[]`, union each role's packages/pieces, and dedupe pieces by name and tool/MCP refs by set
— the additive-union semantics are real, exercised by `assemble-agent.test.ts`. **Partially built:** a role
still names capabilities *through* `packageIds` rather than referencing skill-Pieces/tool-groups/MCP directly
per DC-4's letter (packages remain the addressing unit; they decompose into the three types only at resolution,
not at authoring time), and the `registerMcp` adapter port that would let an MCP reference actually connect on
a bare backend is still open — see `ROADMAP.md`'s "Core-context / roles / pieces" row.

### Prompt structure (DC-1, DC-6, DC-7)
coa's prompt effort prioritizes the **structural** levers it owns — tool declarations/descriptions,
output-format contracts, bounded context-shaping — over added identity/safety prose. The assembled prompt is an
ordered, **named-slot registry**: identity → model → tone → tool-use conduct → code-change discipline →
governance orientation → role section(s) → project context → a volatile tail (env/date), one labeled block,
last. Slots 1–7 form the cache-warm stable prefix; the tail is the only genuinely volatile region. Project
context itself splits by volatility: static facts (an AGENTS.md-style include) sit right after roles; dynamic/
retrieved context (repo map, task) rides the volatile tail. The fidelity ladder tops out at an Aider-style
ranked tree-sitter repo map, auto-engaging where M4 already has a grammar for the project.

**Shipped:** `packages/shared/src/slots.ts`'s `SLOTS` is exactly this nine-slot skeleton (`identity, model,
tone, tool-use, code-discipline, governance, roles, project, volatile`), consumed by `render-sections.ts`
(pure, byte-stable rendering) and validated by `slots.test.ts`/`render-sections.test.ts`. **Partially built:**
the AGENTS.md static-include toggle and the ranked repo-map fidelity ladder are M4 concerns tracked in
`ROADMAP.md`, not yet wired into the `project` slot.

### Skills default to always-on (DC-8)
The composition model is designed so skill-Pieces *can* be on-demand/triggered later (progressive disclosure),
but this effort ships **always-on (push) skills first** and defers the trigger/retrieval machinery as a
deliberate scope cut, not an oversight.

### Verification and safeguards (DC-9, DC-10)
The standing check for "does the core help vs. hurt, net of cost" is a **frozen, objective A/B**: ~20-30 tasks
with hidden tests (no LLM-as-judge — a coa backend grading its own output is disqualifyingly flattering,
[Bias in the Loop](https://arxiv.org/html/2604.16790v1)), `coa raw` vs `coa core-on`, scored on resolve rate
**and** the M7 ledger's cost/token delta together (a resolve-rate gain at a large token-cost increase is a net
loss). Composition also needs slot-order regression coverage (so additive stacking cannot silently reorder or
drop a governance-critical slot) and sanitization of injected project context (AGENTS.md/repo files) against
control-character/injection vectors before it enters the governed prompt.

**Decided, not yet built:** no A/B harness, frozen task set, or sanitization pass exists in code yet. Slot-order
*coverage* exists as direct assertions (`slots.test.ts`, `render-sections.test.ts` check DC-6 order and
per-slot concatenation) rather than the snapshot-per-role-combination form the spike proposed. Tracked as open
work, not claimed as shipped.

### No coa-added safety/refusal guardrails (DC-11)
coa's context assembly does not add model-behavior guardrails (refusal posture, "don't answer harmful
prompts") — they duplicate the model's own trained safety, cost adherence tokens for no governance value, and
coa does not govern how a user uses their agent. The system's only two blocks remain the M3 close-gate and the
M7 cost-cap (SC-1); the prompt layer adds none. Narrow operational-security hygiene ("don't echo secrets") is
allowed but strictly opt-in, in the removable `core` package — never in the mandatory baseline.

**Shipped:** the `baseline-safety` Piece is gone. `packages/core/src/session/baseline-pieces.ts`'s
`baselineStablePieces()` returns only `[IDENTITY, TONE, TOOL_USE]` — no safety/refusal Piece in the always-on
set (commit `9e5882d`, "drop the always-on safety guardrail from the baseline scaffold").

### Maximal configurability (DC-12)
Every registry this model touches — roles, packages, tool-groups, core Pieces — is designed to merge built-in
defaults with user `.coa/` definitions (add or override, drop-unknown at the edge, never throw), so authoring a
role or package is a data change, not a code change. In-app authoring (a UI to build/edit roles, Pieces, etc.)
is out of scope for this effort but must not be designed out.

**Partially built:** `.coa/`-rooted registries already exist for several concerns (`.coa/scopes.yaml`,
`.coa/generate.yaml`, the `~/.coa/accounts.yaml` account registry), establishing the merge pattern, but the
role/package/core-Piece registries specifically do not yet load a user `.coa/` override — see `ROADMAP.md`'s
"Core-context / roles / pieces" row (the DC-12 `.coa` merge is called out there as open).

## Consequences (good / bad)

**Good**
- A role finally does something beyond gating tools: it can carry its own prose, and stacking roles is a
  well-defined union rather than last-writer-wins or silent conflict.
- The slot skeleton gives every future Piece a fixed, cache-aware home instead of an ad hoc append, and removing
  the safety Piece cuts adherence-tax tokens without losing any governance the system actually relies on.
- The verification stance (DC-9) commits coa to proving the core helps before it grows further, instead of
  accreting Pieces on intuition.

**Bad**
- The model is only partially realized: capability references still route through packages rather than the
  three types directly, `registerMcp` is unwired, no A/B harness or sanitization pass exists, and the `.coa`
  merge doesn't yet cover roles/packages/core Pieces. A reader must check `ROADMAP.md` for current status
  rather than assume this ADR describes a finished system.
- DC-9's A/B is real engineering work (a frozen task set, k=3-5 repeats, cost/token accounting) that competes
  with other module work for priority; until it exists, "does the core help" remains an assumption, not a
  measured fact.

---

_Last reviewed: 2026-07-06_
