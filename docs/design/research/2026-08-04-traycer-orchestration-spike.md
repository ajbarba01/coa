# Traycer — cross-provider agent orchestration, read against coa

A spike on [traycerai/traycer](https://github.com/traycerai/traycer) (MIT), the "nerve center for agentic
coding" desktop app that runs Claude Code, Codex, Cursor and OpenCode side by side. Traycer occupies
adjacent ground to coa's orchestration slice, so the question is what it has actually solved, where it
differs on purpose, and what is worth taking.

Read at commit `8f21d50` (2026-08-04), plus the docs site.

## What is actually open

The repo is `protocol/` (the client↔host wire contract) + `clients/` (Electron desktop, React renderer,
CLI, shared transport/auth). **The host — the daemon that owns orchestration — is not in it.** `AGENTS.md`
states it plainly: *"The Traycer Host and cloud backends are **not** here — the CLI provisions a signed
host from GitHub Releases."* Releases are built and signed in an internal repo, verified against embedded
minisign trust anchors, and `make dev-desktop` *"talks to the **production** cloud — no local backends."*

So: MIT covers the contract and the UI. The orchestration logic, the message broker, the harness argv
construction, and the agent runtime are closed. You cannot build or self-host the thing that does the
work. That said, the contract is unusually well-documented — the schema files carry long design-rationale
comments — so the *design* is legible even though the implementation isn't. That is what makes this
worth reading.

Pricing confirms the model: **BYOA is $0** and includes the entire local feature set *including all of
A2A* (which requires same-user, same-host anyway). Paid tiers sell cloud sync, sharing, and resold
inference at a 20% markup. The orchestrator is not the business.

## Two integration tiers, not one

The headline "runs your agents side by side" is two different mechanisms with very different fidelity:

**Chat agents** — host-side runtime adapters normalise each provider into a `RuntimeEvent` stream
(`text.delta`, `tool_call.started`, `turn.completed`, `compaction.*`, …). 16 providers reach this tier:
claude, codex, opencode, traycer, cursor, grok, qwen, kiro, droid, kimi, copilot, kilocode, openrouter,
amp, devin, pi, hermes, omp. This is the tier that gets model-switching and full A2A.

**Terminal agents** — a real PTY running the vendor CLI verbatim in a tab. Only Claude Code, Codex and
OpenCode. The host resolves argv and caches it on the record (`terminalShellCommand` /
`terminalShellArgs`, *"resolved argv, including dynamic resume/session/binding flags"*); resume keys are
the vendor's own — `claude --resume <id>`, `codex resume <id>`, `opencode --session <id>`.

Traycer binds a PTY session to an agent record purely through **environment variables**
(`TRAYCER_AGENT_ID`, `TRAYCER_EPIC_ID`) and observes it through **provider hooks** that call back into
the CLI: `traycer agent turn-ended-from-hook`, `…activity-from-hook`, `…title-from-hook`,
`…session-observed-from-hook`. Every hook is deliberately lenient — a Claude Code launched standalone
outside Traycer exits 0 with `accepted: false` and no stderr noise, *"the hook fires unconditionally, so
any benign condition must be a silent no-op."*

Two consequences worth internalising:

- Transcripts are read from **the provider's own session history via its SDK**, never from PTY
  scrollback — *"Provider history survives the PTY closing; there is deliberately no raw scrollback
  fallback."* Fail-closed rather than partial.
- coa's `RuntimeAdapter` is an **in-process** port: it rents a loop and injects into it (`interceptTool`,
  `render_context`, `cache_control`). Traycer's harness port is an **out-of-process** one: spawn the
  vendor's binary, then observe it from outside via hooks and provider APIs. Neither is strictly better,
  but they are not convertible, and this is the single biggest architectural divergence.

## The A2A suite — the part worth studying

This is Traycer's real contribution, and it is better than its marketing. There is no @-mention syntax
and no structured inter-agent RPC; the interop layer is **text plus a CLI**, chosen because four vendor
CLIs share nothing else.

### Shape

`agent.sendMessage` is **fire-and-forget**. It enqueues a `MailboxEnvelope` on a host-side broker's
per-receiver queue (RAM-only) and returns immediately. *"Any reply travels back via a separate
`agent.sendMessage` call from the receiver."* There is no blocking call anywhere in the system.

Delivery differs by surface. GUI agents get a tool, `traycer_a2a/traycer_send_message`. Terminal agents
get an **inbox stream**: a Claude Code *plugin* spawns `traycer monitor` as a background command inside
the session; it subscribes to `agent.inbox.subscribe` over a localhost WebSocket and prints each message
to stdout, where Claude Code's background-output surface shows it to the model. Messages queue if no
monitor is connected and replay on open.

The injected text is itself a versioned, byte-pinned contract:

```
[traycer:agent-message] from Reviewer (agent a-7) [claude]
[traycer:agent-message] A reply is expected. Use the traycer_send_message tool to reply with responseId="r-1".
```

### The five ideas in it

**1. `responseId` names a thread, not a message.** Stated to the model directly: *"follow-up messages
may arrive with the same responseId, and one reply with it answers everything on the thread. Only a
reply carrying the responseId completes the request — a fresh message does not."* Pending requests are
idempotent per sender→receiver pair.

**2. Truncation is assumed, and recovered from.** The background-output surface truncates large payloads,
so `agent.inbox.read` returns the broker's retained ring with full bodies, and every injected CLI message
ends with *"if the message above looks cut off, read it in full with: `traycer agent inbox`."* A
hard-won detail you only get from shipping.

**3. The inactivity notice — the best thing in the repo.** Because sends are async and receivers are
opaque third-party CLIs, the sender can wait forever. A broker sweep fires a typed notice at any sender
holding an unanswered `expectReply` thread, carrying *why*:

| reason | meaning |
| --- | --- |
| `turn-ended` | receiver's Stop hook fired with no reply — accurate primary signal |
| `exited` | receiver's process exited |
| `quiet` | PTY-silence watchdog — explicitly advisory, receiver may still be mid-turn |
| `user-stopped` | a human stopped the turn; it will not resume itself |
| `errored` | turn died on an error (e.g. rate limit); raw text in `detail` |
| `awaiting-input` | **receiver is blocked on a human** — question or approval — and will not reply until a person responds |
| `receiver-cancelled` | thread closed, message dropped; *"the sender must not re-send or spawn a replacement"* |

Note how much of this is honesty about signal quality: `turn-ended` is trusted, `quiet` is flagged as a
guess. And `awaiting-input` is the interesting one for us — see below.

**4. Role claims as advisory coordination.** An agent self-issues a free-text role over a free-text scope
("Planner — auth migration"), durable in a Task-local registry. Deliberately **no enum**: *"a hard-coded
Planner/Reviewer/QA enum is explicitly the wrong shape here."* Claims **grant no permissions** and
overlap is allowed — the claimant is *told* about duplication rather than blocked. Near-duplicates are
caught by a derived, case-folded, never-persisted identity key. Broadcast is best-effort and *"never
rolls back the registry: a claim is durable responsibility; a broadcast is a courtesy."* Off by default
(`features.agentRoles = false`).

**5. An append-only communication graph.** Every delivery, notice, and creation writes an immutable row
to a host SQLite log; the autoincrement id doubles as the resume cursor, giving exactly-once gap-free
resume with no dedup. Kinds: `a2a_message`, `a2a_notice`, `agent_created` (lineage recorded at birth, so
the edge exists before any message crosses it). An open thread is *derivable*: an `expectReply` send with
no later row carrying its `responseId` in `inReplyTo`.

### The capability matrix

Traycer ships the asymmetry openly instead of hiding it behind a floor. Three capabilities, widening
gates: **reference** (any agent, always) → **transcript** (same user; terminal transcripts must be read
on the owning host) → **deliver a message** (same user, *and* both agents local to the same host, *and*
both runtimes support A2A). Cross-host sends are rejected with `RECEIVER_NOT_LOCAL`, *"rejected rather
than queued."*

The runtime gate is blunt: on the Terminal interface, **only Claude Code has an inbox**. Codex and
OpenCode terminal agents are addressable and readable but *"simply have nowhere to deliver a message."*
Claude Code is the privileged backend and the feature matrix is built around it.

## There is no agent registry

The finding that most directly touches our stage 1: **Traycer has no reusable agent definition.** No
persona files, no templates, no `description`. An "agent" is a runtime session record minted by
`agent.create` inside a Task. `name` is a display title, not something a selector reads.

All delegation intelligence lives in **one user-authored Markdown file**, `~/.traycer/agent-selection-guide.md`,
seeded from a host-generated default reflecting that machine's configured providers. It is handed to the
model verbatim under a header, and the model decides. No scoring, no tags, no embeddings, no classifier,
no second model call:

```
Agent selection instructions from ~/.traycer/agent-selection-guide.md:

<the user's prose>

Permission mode: Use `full_access` unless the user's agent selection guide explicitly instructs you to
use `supervised` or `auto_accept_edits`; never infer a more restrictive permission mode from the task,
the current or parent agent's mode, or a general safety preference.
```

Two things to sit with. First, when no guide exists the selection content degrades to *"No agent
selection guide found."* — **but the permission paragraph is appended unconditionally**. The one welded-on
invariant in the system protects against the model being *too cautious*. Second, `agent create` defaults
`permissionMode` to `full_access`, and the "readonly CLI surface" that hides `agent create` from help is
**cosmetic** — the repo documents that Commander still runs a hidden subcommand typed explicitly, and only
`worktree delete` actually takes the readonly flag into its builder.

Peer discovery is a live pull (`agent.list`), not a session-start injection, and it renders the forest
**from the caller's point of view** — `You:` / `Parent chain (nearest first):` / `Siblings:` / `Children
(agents you spawned):` / `Other agents (user-triggered):` — with a per-row capability token (`R`, `S`,
`R/S`, `-`) omitted on your own row because *"you don't read your own transcript or message yourself."*
There is no pagination, cap, or truncation: the whole epic renders every time.

**Project scope was built and withdrawn.** Older hosts emitted a per-workspace
`.traycer/agent-selection-guide.md`; the schema still carries `priority`, but nothing reads it and
*"current clients ignore workspace entries instead of layering them over the global guide."* The guide is
now global and **per-device**. The docs site still advertises the workspace file as refining the global
one — the docs and the code disagree, and the code is newer.

## Depth, cycles, and stopping

**No depth limit exists anywhere.** Nothing distinguishes a child from a root caller on `agent.create`.
The evidence that this is intentional is also evidence of the cost: the list formatter walks the entire
ancestor chain and renders `[cycle]` rather than looping, so the parent graph is not structurally
acyclic; and `agent.stop --cascade` walks `parentId` descendants under a *"transient cancel-guard so the
subtree can't revive itself"* — a guard you only write after watching a subtree revive itself. Stopping
is explicitly not terminal: a later message wakes any of them normally.

## Governance and cost

Three permission modes (supervised / auto-accept-edits / full access) applied per agent, next-turn-only,
fixed at launch for terminal agents. These are **passed through to the vendor CLI**, not enforced by
Traycer — and per-provider "Terminal CLI arguments" are a supported setting explicitly documented for
bypass/full-auto flags, with `--dangerously-skip-permissions` appearing as a test fixture. Traycer does
not intercept individual tool calls. Worktrees bound *which checkout* an agent writes to; there is no
process or filesystem sandbox.

**There is no spend cap.** Not a weak one — none. What exists is provider rate-limit *observability*
(windows classified healthy / running_low / limited at 80/95/100%) and a nice touch: daily/weekly/monthly
spend is rendered **into the agent's own prompt**, so the model can see its budget state. Observability,
not enforcement. Running out of credits pauses automation; that is quota exhaustion, not a cap.

## Head to head

| | Traycer | coa |
| --- | --- | --- |
| Integration | out-of-process: spawn vendor CLI, observe via hooks | in-process: rent the SDK loop, govern at `PreToolUse` |
| Agent identity | runtime session record; no reusable definition | registry of reusable definitions (stage 1) |
| Selection | one prose Markdown file, device-scoped | required `description` + derived Piece + deterministic `find_agent` |
| Topology | peer mesh, unbounded depth, cycles rendered not prevented | parent→child, depth capped at 1 |
| Dispatch | async fire-and-forget + threaded reply | `spawn_agent`, blocking, Task-shaped |
| Per-tool governance | none — pass-through to vendor | deny-or-abstain at coa's own seam (ADR-0029) |
| Cost | none (rate-limit observability only) | hard cap, one of only two blocks |
| Record | append-only SQLite comm graph per Task | M1 change-event spine |
| Provider breadth | 16 chat / 3 terminal / 1 with an inbox | claude + deepseek + longcat |
| Openness | contract + UI MIT; host signed and closed; cloud for sync | fully local, single-user |

The honest summary: **Traycer is far ahead of coa on breadth and on multi-session topology, and has no
governance layer at all.** It is an orchestration surface with a deliberately open permission posture.
coa is a governance layer that has not yet grown multi-session topology. These are close to complements,
which is why so much is takeable without touching coa's thesis.

## What to adopt

Ranked by value, all independent of Traycer's closed host.

1. **The inactivity-notice reason enum.** Any dispatch that is not a blocking call needs this, and coa
   will need it the moment the orchestration slice lands. The taxonomy is the asset — especially the
   discipline of marking `quiet` advisory while `turn-ended` is trusted. Cheap to build on coa's existing
   Stop-hook seam.
2. **`awaiting-input` as the answer to child-approval routing.** The spike's open item is *"routing a
   child's approval request… to whoever is watching the root session."* Traycer's answer is to not route
   it: tell the **sender** its counterparty is blocked on a human, and let the human find it. That
   sidesteps building an approval fan-out before stage 3's channel exists, and it degrades honestly. Worth
   putting in front of the stage-2/3 design as an option, not folded in silently.
3. **`responseId` as a thread id, not a message id**, with the semantics stated in the injected text.
   Only relevant if coa adds non-blocking dispatch — but it is the correct shape and costs nothing to
   copy.
4. **Reserved, unforgeable system sender id.** `traycer:system` is rejected at agent creation *because*
   the persisted sender envelope is agent-shaped: *"If a real agent could be named this, every system
   notice the platform sends would be forgeable."* coa's change events carry provenance (`authored`);
   the same reservation should hold for any actor id a model can influence. Small, cheap, real.
5. **Output designed as input.** Rendered rows contain the literal token the next command takes (`--profile
   <value>`) *"so an agent can copy a row straight into `traycer agent create` without transcribing an id
   out of prose."* Directly applicable to what `find_agent` returns.
6. **"Never invent availability."** A null rate-limit window renders `unknown`, never `0% used`, *"so a
   formatted read can't imply headroom the provider never claimed."* This is exactly the right instinct
   for coa's capability profile and flag surfacing, where a null-fallback baseline already exists.
7. **Default-nest, not default-leak** for child telemetry: an unclassified or newly-added child event
   nests under its parent card rather than surfacing un-parented. Total classification by construction.
8. **Cascade stop with a cancel-guard.** Abort derivation is on coa's orchestration list; the
   guard-against-self-revival and "stopping is not terminal" are both earned details.
9. **Relationship-relative listing.** Rendering a live agent list from the caller's position rather than
   as a flat table. Applies to a future running-session list, not to stage 1's definition registry.

## What to reject, and why it is useful to have seen

- **Prose-file-only selection.** coa's structured `description` + deterministic `find_agent` is both
  better and P1-compliant. Traycer's guide is a single global file with no per-agent capability string
  anywhere in the object model — it cannot answer "which agent" except by asking the model to read an
  essay.
- **Unbounded depth and unprevented cycles.** The `[cycle]` renderer and the anti-revival cancel-guard are
  artifacts of not having a bound. coa's depth cap looks better after reading this, not worse.
- **Full-access by default, plus an instruction forbidding the model from being cautious.** This is the
  exact inverse of SC-1's posture and it is welded on unconditionally. Strong confirmation that coa's
  gate belongs where it is.
- **A closed enum of provider ids inside a frozen wire schema.** `agent.list` is on its **sixth major**,
  each bump adding nothing but new harness ids to an enum, carrying an O(n²) lattice of downgrade paths
  that filter rows a stale client would fail to decode. This is the most actionable warning in the
  repo: **coa's M0 schemas must keep provider/backend ids open**, or every new adapter is a breaking
  change.
- **Ambient identity.** The sender is derived from an environment variable and never asserted — any
  process in that session can speak as that agent. Fine for a single-user local app; not a model coa
  should copy into its record.
- **No spend cap.** coa's hard cap is a genuine differentiator, not table stakes.

## Two open questions this raises

**Project-scoped agent config.** Traycer built per-workspace guides and withdrew them to global-only,
leaving dead `priority` plumbing and stale docs. Stage 1 ships `.coa/agents/` + `~/.coa/agents/` with
project-wins precedence. Their reason is not documented and their object is one prose file rather than a
registry of definitions, so this is not a refutation — but it is the one place where somebody else's
experience runs against a decision we've made, and it is worth knowing before the plan is written rather
than after.

**Asymmetry versus floor.** Traycer publishes a capability matrix and lets features be absent per
provider; only Claude Code gets a terminal inbox. coa's no-lock-in rule says the neutral floor always
works and the high-fidelity layer auto-engages. If coa grows session-to-session messaging, that tension
becomes a real decision: honest asymmetry, or a text-injection floor that works everywhere.

## Method and confidence

The clone was read directly rather than summarised from the web. Coverage is strongest where it matters
most: the A2A message format, inbox contracts, communication graph, role claims, and the `agent.*` RPC
family were read in full, as were the agent object model and the product docs. Coverage is thinnest on
the host framework internals (versioned-RPC negotiation, mux, persistence/CRDT details) and on the
chat-tier runtime adapters — two parallel readers assigned to those areas were killed by a session limit,
and the areas overlap heavily with code that is closed anyway. Nothing in the recommendations above rests
on that unread material.

Where the docs and the code disagree — workspace-scoped selection guides, "switch models instantly"
(actually next-turn-only, GUI-only, and a whole-tuple replace), and "Loops" (marketing only; the docs page
404s and no bounding mechanism exists) — this document follows the code.

---

_Last reviewed: 2026-08-04_
