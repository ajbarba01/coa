# 0027 — A tool is aliased or owned, never both

- Status: accepted
- Date: 2026-08-02

Governs how coa presents its tool catalogue to a prior-rich harness. Realises the arc's "same tool,
different clothes" ruling against what the harness actually permits, measured in the
[control ledger](../design/research/2026-08-02-claude-sdk-control-ledger.md).

## Context and problem

coa maintains **two** tool surfaces today. On the Claude path the model gets Anthropic's built-ins; on
the pure-API path it gets coa's own (`packages/core/src/workbench/base-tools.ts` — `Read`, `Write`,
`Edit`, `Bash`, `Glob`, `Grep`, `WebFetch`, `WebSearch`). That split is the "several harnesses smashed
together" problem the arc exists to remove, and it blocks anything needing coa to own the handler:
honest tool input fed back to the model, tool auto-repair, and per-call enrichment from M2/M4.

The obvious unification was to empty the built-in set and re-present coa's tools under the native
names, so the model keeps its trained priors while coa owns the implementation. Whether that works
depended on one unmeasured fact.

## Decision drivers

Both measured live against SDK 0.3.196 / CLI 2.1.196:

- **`toolAliases` is honoured at dispatch.** With `toolAliases: { Read: 'mcp__coa__peek' }`, a
  model-emitted `Read` executed coa's MCP handler and coa's marker came back — not the file's contents.
- **An alias redirects a visible name; it never publishes one.** With `tools: []` and the same alias,
  `system:init.tools` advertised only `mcp__coa__peek`. Removing the built-in removes the name, and the
  alias then has nothing to point at.

Together these mean the two capabilities are **mutually exclusive**. There is no configuration in which
coa authors a tool's schema *and* the model sees a native name for it.

## Considered options

1. **Alias everything, empty the built-ins.** Ruled out by measurement — the names disappear with the
   built-ins.
2. **Own everything under `mcp__coa__*`.** Works: coa's tool was advertised, the model reached for it
   unprompted, and coa's handler ran. Costs every trained prior on the native names.
3. **Keep every built-in, alias nothing.** Today's Claude path. coa observes but does not execute.
4. **Choose per tool.**

## Decision

**Per tool, coa picks exactly one of two postures:**

- **Aliased** — the built-in stays in `tools` and is aliased to a coa tool. coa owns the
  *implementation*; the model sees Anthropic's name, schema and description, so the priors survive.
- **Owned** — the tool is omitted from `tools` and coa's own is registered. coa owns name, schema,
  description and implementation, under `mcp__coa__*`, with no prior on the name.

The posture is **configuration, not a default**, and ships off. This is the D85 floor applied to the
migration itself: the Claude path is currently coa's best-performing path, and a change made for
control that degrades it is a bad trade. It also honours the arc's standing ruling that demotion
belongs to the orchestration plane, while everything in the model's own competence — edit smarts, tool
judgment, the `claude_code` preset — is layered on rather than replaced.

Take control where coa **adds** something, in this order: orchestration (delegation) first, since coa's
`spawn_agent` does what native delegation cannot; then read-only retrieval (`Read`/`Grep`/`Glob`),
where coa gains M2/M4 enrichment and an honest record at low behavioural risk; then mutation
(`Write`/`Edit`), only against a measured parity comparison; and `Bash` last or never, since sandboxing
and process isolation are where borrowing genuinely earns its keep.

The seam is `resolveToolTransport` in `packages/adapter-claude-sdk`: it already computes availability
and registration, so the demote set belongs there and nowhere else.

## Consequences

**Good.** One catalogue can serve every backend, with presentation chosen per backend — the arc's
three-plane model made concrete rather than aspirational. Each tool's posture is an explicit,
reversible decision with a stated reason, and `coa raw` plus the off-by-default flag keep the strict
superset intact.

**Bad.** A per-tool posture is a per-tool judgement, so the tool surface stops being uniform and
becomes something that needs maintaining and justifying. Owned tools lose the model's trained priors
and may be reached for less often — the arc's risk R3, now narrowed to the owned set rather than
applying to everything. Aliased tools inherit a schema coa does not control and that upstream may
change under it. And coa's base tools were written for prior-free API backends, where anything beat
nothing; putting them on the Claude path is a quality claim that has not been tested and must be
measured, not assumed.

---

_Last reviewed: 2026-08-02_
