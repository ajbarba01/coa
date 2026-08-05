# The agent registry and subagent dispatch

Design for how a coa agent discovers, selects, dispatches, and authors other agents. It supplies the
object model that [the backend-independent agent arc](./2026-07-31-backend-independent-agent-arc-design.md)'s
orchestration slice consumes: that plan builds `spawn_agent`'s mechanics, this one decides what a
subagent *is* and how a parent comes to name one.

> **Partly revised.** The registry half of this design stands. Its dispatch half assumed a parent waits
> for one child to finish, which does not survive agents that can message each other — see
> [inter-agent messaging and non-blocking dispatch](./2026-08-04-inter-agent-messaging-and-dispatch-design.md)
> for the revised dispatch shape, the dropped depth bound, and the staging that supersedes the one below.

## What this is for

A parent spawns a subagent by **name**, against an agent definition. The model is abstracted — it
lives on the agent, not on the spawn call — so "a Claude orchestrator driving a DeepSeek worker"
becomes "spawn the `researcher` agent, which happens to be DeepSeek-backed." Cross-provider
orchestration rides the registry rather than the tool signature.

## The starting position is better than it looks

coa already has an agent object. `AgentSummary`
(`packages/console-viewmodel/src/agents.ts`) carries `ref`, `name`, `icon`, `color`,
`scope: 'project' | 'personal'`, `model`, `provider`, `reasoning`, `roles`, `packageIds`, and
`exclude` — and its own comment states the intent this design completes: *"An agent (= a Role, SPEC
CON-1) as the console lists it. Mock today, shaped like the future `listRoles` read so the swap is a
data-source change… project agents live committed in `.coa/` (shared via git); personal agents are
user-level, outside the repo."*

So the project/personal split is modelled, model-and-provider already sit on the agent, and
composition already runs through coa's roles/packages vocabulary. Two things are missing: the object
is **console-local and mock** (persisted to Electron's userData, invisible to the daemon), and it has
**no `description`** — the one field delegation depends on.

This is a promotion, not a new subsystem. There is one agent concept in the product: what you
configure in the agents editor is what a parent can spawn.

## Decisions

### One dispatch path

Every spawn resolves to an agent definition. There is no ad-hoc "just give me a worker with model X"
path. The one-off case is served by **shipping generic definitions** (a general-purpose worker, a
read-only explorer) rather than a second code path — which is what Claude Code's built-in
`general-purpose`/`Explore` agents effectively are.

One mechanism means one governance story, one record, and one discovery surface. Everything a parent
dispatches is reproducible config.

### The object gains a required description

`description` becomes required: it is what a parent reads to decide, and the agents editor shipped in
W4 is where it is written. Everything else on `AgentSummary` stays as it is.

### Scope is cumulative upward

The in-scope set for any session is **built-in ∪ personal ∪ project**. Personal agents are always in
scope — they are the broader collection, available wherever you work; project agents add to them.
There is no per-project opt-in.

### Resolution

A spawn names a `ref`. Precedence on collision is **project > personal > built-in** — most specific
wins, consistent with coa's built-in ∪ user merge (ADR-0003).

Duplicate refs *within* one scope are a **compile error surfaced as a flag**, never a silent pick.
Claude Code resolves same-directory duplicates by undocumented filesystem read order and patches over
it with a `/doctor` check; coa should not inherit that ambiguity.

### Discovery is a derived Piece plus a live lookup

Every in-scope agent contributes `name` + `description` to the parent's context through a Piece.
Measured against a 200k window this is cheap — under 1k tokens at realistic registry sizes — so no
search machinery is built for the common case.

`find_agent` ships alongside it: a deterministic keyword match over name and description, returning
refs with their descriptions. **Deterministic because P1 forbids a model call on a critical path.**
It queries the *live* registry, which makes it the answer for an agent added mid-session by another
window or by the user editing in the console.

The two cover each other: the Piece gives the model its defaults cheaply at session start, and
`find_agent` is the escape hatch once the registry has moved since. Neither has to be complete alone.

**Revisit trigger:** if a real project's in-scope set passes ~40 agents, or the Piece measurably
crowds context, `find_agent` replaces the Piece rather than supplementing it — the same swap D100
describes for tools.

### Dispatch

```
spawn_agent({ agent: string, description: string, prompt: string })
```

`description` and `prompt` mirror Anthropic's `AgentInput` verbatim, carrying the trained prior for
free. `agent` replaces `subagent_type` because it resolves against coa's registry. There is no
`model` or `provider` — those live on the agent.

**`agent` is validated against the live registry at dispatch**, never against a list baked at session
start. Compiled prompts are frozen byte-stable for cache warmth, so a Piece written at session start
is stale the moment an agent is authored; the registry, not the prompt, is the authority. An unknown
ref returns an unapplied result naming what does exist (SC-1 — surfaced, never a crash).

This makes author-then-spawn work in one turn: `author_agent` returns the new `ref`, and the model
spawns it immediately without any lookup, because it just created it.

### The depth bound is applied at assembly

> **Superseded.** The depth bound is dropped entirely; the root cost cap is the sole fan-out bound and a
> child may spawn. None of the assembly machinery below is built. See the revision linked at the top.

`AssemblePiecesContext` gains `depth` (0 = root, 1 = child). In `assembleAgent`:

1. `spawn_agent` is filtered out of the resolved `toolRefs` when `depth > 0`.
2. The agent-list Piece is **derived from the resolved frame**, emitted only when `spawn_agent`
   survived.

A subagent therefore never has the Piece *stripped* — it is never generated, because the capability
it describes is absent. Nothing to filter, no name-matching, and no way for prose and capability to
drift apart. The pattern already exists one line up, where `volatile` is emitted conditionally on
`CORE_PACKAGE_ID` being included.

Two consequences worth stating:

- **The bound lives in neutral assembly, not `renderNative`.** The arc's original wording put
  depth-guarding in M9. Depth is neutral policy: applying it once in core means both the Claude and
  pure-API paths are correct without either adapter knowing the rule exists — a better reading of
  "backend-independent by construction" than per-adapter enforcement.
- **`find_agent` survives the strip.** It is read-only, and a child that may author benefits from
  checking what exists before duplicating it. A child can look but not dispatch.

The Piece cannot be carried by an `AgentPackage`, because its content *is* the live registry listing.
Packages carry the toolRefs; the Piece is generated.

### Authoring

`author_agent` is available whenever the model judges it useful — it is a tool like any other, and the
model's judgement about when to reach for it is the model's own competence, not something to cage.

It validates the definition through M5's `compile`, records a change event with provenance
`authored`, and **always requests approval**. It can never be auto-accepted. That is the control.

**Tool grants inside a definition are availability, not authority.** A child is a coa session, so
coa's own `PreToolUse` gate runs for every call it makes regardless of what its definition declares.
There is therefore **no author-time containment check**: an agent may author an agent that names
`Bash`, exactly as it may itself call `Bash`, and both are gated identically at use. The single field
coa will not honour is a permission posture that would disable its own gate — not a check, just a
field coa does not map.

A child may author; a child may not spawn. Two levers for two different risks: approval governs
authoring, the depth cap governs fan-out.

### Model metadata

The model catalog is already maintainer-editable per provider (ADR-0016) and that editing **is** the
curation — an agent sees the effective list and nothing more. Structured capability fields (context
window, price, tool-calling, reasoning support, modality) are added when P2 brings OpenRouter and the
list stops being hand-picked.

**No prose descriptions on models.** The survey found capability filtering is structured everywhere it
is done seriously — OpenRouter's own router filters on feature support, not on written descriptions —
and prose per model goes stale with every release. Agents get prose because choosing one is a
judgement about task fit; models get fields because choosing one is a capability filter.

## Dependencies

**The approval channel must land first.** M0 already schematises it — `{ t: 'permission', requestId }`
on the turn frame, `{ kind: 'approval', requestId, sessionId, summary, tool?, input?, diffHandle? }`
on the push, and `blocked-approval` as a session state. What does not exist: anything that emits
those, a response verb, and daemon-side pending state a tool can await. The console's
`respondApproval` today only mutates renderer-local UI state and never reaches the daemon. So this is
plumbing against a settled contract, not a new protocol — but `author_agent` cannot ship before it.

**Unresolved: routing a child's approval request.** A child is its own conversation with a parent
link, so its approval push goes to a conversation the console may not be displaying. Child approvals
need routing to whoever is watching the root session.

**Registry promotion gates everything else.** The daemon cannot resolve a spawn against a
console-local file, so moving the registry daemon-side is a prerequisite for both dispatch and
authoring.

## Out of scope

Depth greater than one (OPEN.md); the worktree manager and concurrent writers; `spawn_agent`'s own
orchestration mechanics — child sessions, parent links, abort derivation, root-budget attribution —
which belong to the arc's orchestration slice and consume this design's output; the general
live-approvals work beyond what `author_agent` needs; structured model capability fields, which wait
for OpenRouter.

## Staging

Three plans off this one design, in dependency order:

1. **Registry promotion** — `description` added, persistence moved to `.coa/agents/` +
   `~/.coa/agents/`, daemon-owned registry with RPC reads, console becomes a reader, and the
   **generic built-in definitions** ship as part of the built-in scope (a general-purpose worker and
   a read-only explorer). Those are what make "one dispatch path" tolerable, so they cannot lag the
   dispatch work. Prerequisite for everything.
2. **Discovery and dispatch** — the derived Piece, `find_agent`, `spawn_agent` with live validation,
   the depth override in assembly. Lands with the orchestration slice, which supplies the child
   session machinery.
3. **Authoring** — `author_agent`, once the approval channel exists.

## Verification

`pnpm typecheck` and `pnpm test` green at each stage; the baseline known-failure state may not grow.

Stage 1: a daemon-side read returns the merged built-in ∪ personal ∪ project set with project winning
a ref collision, and a duplicate ref within one scope raises a flag rather than resolving silently.

Stage 2: a child's rendered frame contains no `spawn_agent` and no agent-list Piece, while retaining
`find_agent`; an unknown ref returns an unapplied result naming what exists; an agent authored
mid-session is spawnable in the same session without a restart.

Stage 3: `author_agent` produces no spawnable agent until approved, and the change event carries
provenance `authored`.

Then drive the app: author an agent from a live session, approve it in the console, and spawn it — in
one session, without a restart.

---

_Last reviewed: 2026-08-04_
