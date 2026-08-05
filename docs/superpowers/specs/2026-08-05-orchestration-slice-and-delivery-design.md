# The orchestration slice and the delivery path

Design for the first plan of the agent arc's dispatch half: child sessions, non-blocking `spawn_agent`,
and the delivery path by which anything reaches an agent that is already working.

It consumes the registry shipped by
[the agent registry and subagent dispatch design](./2026-08-04-agent-registry-and-subagent-dispatch-design.md),
follows the dispatch shape set by
[inter-agent messaging and non-blocking dispatch](./2026-08-04-inter-agent-messaging-and-dispatch-design.md),
and builds the orchestration slice named P1 in
[the backend-independent agent arc](./2026-07-31-backend-independent-agent-arc-design.md). Prior art is read
against coa in [the Traycer spike](../../design/research/2026-08-04-traycer-orchestration-spike.md), which is
where the references to Traycer below come from.

Several load-bearing claims in those documents did not survive being checked against the code. Where this
design contradicts them it says so and gives the evidence.

## The split

Two plans. **This design covers plan 1 only.**

**Plan 1 — orchestration mechanics.** Child sessions with lineage, non-blocking `spawn_agent` validated
against the live registry, abort derivation with a cancel-guard, the delivery path, root id in the record,
and minimal console surfacing.

**Plan 2 — discovery.** The derived agent-list Piece and `find_agent`. Its own design, after this lands.

The seam is between mechanics and model-facing discovery. Everything unproven — daemon re-entrancy, abort
derivation, injection timing — sits in plan 1 and is verifiable by tests that name an agent ref directly,
needing no discovery surface to exist. Plan 2 is additive and carries none of that risk.

The consequence, stated so it is not mistaken for an oversight: **a model in plan 1 cannot enumerate
agents.** It must be handed a ref, or use a built-in one. That is what makes plan 1 testable and
human-drivable without being model-complete.

## What the prior designs get wrong

Six claims that were checked. Each changed a decision, and three of them removed work from this plan.

**The cost cap is not per session.** The messaging design states M7 caps per session and that changing this
is stage-2 work. The cap keeps one daemon-global total and its read ignores the session id it is handed. What is
per-session is a separate adapter-level ceiling. So fan-out escaping the cap — the arc's risk R4 — is
already closed by construction: children run in the same daemon and draw down the same wallet.

**Daemon re-entrancy is largely retired by the non-blocking decision.** The arc lists R1 as its headline
risk: a synchronous spawn holding the parent's query open while the daemon runs a whole child session
through itself. A non-blocking spawn holds nothing open. What remains is two independent turn loops over
two entries in one live-session registry, which is already how two console tabs behave.

**The depth cap is dropped entirely**, per the messaging design. No depth on the assembly context, no
filtering the spawn tool out of a child's frame, no conditional Piece derivation. A child may spawn. None
of the arc's depth-guarding text is built.

**A spawn returns an id, not a summary.** The arc says the result carries "both a summary and a handle." A
summary implies completion, and the spawn does not wait for one.

**The allowlist claim is refuted, and coa refuted it first.** The arc states that a tool omitted from the
allowlist never reaches the model, and that the denylist is the wrong lever.
[ADR-0028](../../adr/0028-per-tool-governance-rides-two-seams.md) measured the opposite: the allow list
means **auto-approve**, so it suppressed governance for exactly the tools coa granted. It is now left
permanently empty. Availability belongs to the `tools` option and to MCP registration.

**Native delegation is already gone, and per-tool governance already moved.**
[ADR-0029](../../adr/0029-one-bounded-tool-surface-governed-at-one-seam.md) set a fixed eight-tool built-in
floor and made `PreToolUse` the single per-tool gate, judging every call and never asserting allow. Both
were proven live against the real CLI, including that a `PreToolUse` deny of coa's **own** MCP tool is
honoured — which is what makes a governed `spawn_agent` possible at all. So this plan builds neither a
demotion nor a governance fix. It closes the gap ADR-0029 opened deliberately: *"native delegation is gone
ahead of the governed `spawn_agent` that replaces it, so there is an interval with no delegation at all."*

## Decisions

### Lineage is two links stored in two places

A session carries a parent id and a root id. A root session's root is itself.

Both live in memory on the live session, where abort cascade and delivery routing read them, and durably on
the conversation record, where the transcript projection and the audit record read them. A child gets **its
own conversation id** — it is a full session, not an annotation on its parent.

The root is stored, never derived by walking the parent chain. A walk is how Traycer ends up with a list
renderer that emits `[cycle]` rather than looping; a stored root is constant-time and cannot loop.

### Dispatch is non-blocking and resolves against the live registry

`spawn_agent` takes an agent ref, a description, and a prompt. The input shape mirrors Anthropic's subagent
tool so the trained prior transfers. There is no model or provider argument — those live on the agent
definition, which is the point of routing every dispatch through the registry.

The ref is validated against the **live** registry at dispatch, never a list baked at session start.
Compiled prompts are frozen byte-stable for cache warmth, so any session-start listing is stale the moment
an agent is authored. Stage 1 already made the registry a daemon-owned live read, so this costs almost
nothing.

An unknown ref returns an **unapplied result naming what does exist** — surfaced, never thrown (SC-1).

The tool returns once the child has **started**. Its description must say so in as many words: that it
returns an id, that the subagent runs in the background, that results arrive separately, and that waiting is
wrong. Task-shaped tools carry a trained expectation that the call returns the subagent's report; without an
explicit correction the model waits for a report that never comes. The returned row carries the literal id a
follow-up takes, rather than burying it in prose.

As an ordinary coa tool it is governed at the `PreToolUse` seam like every other call, with no new
governance surface (ADR-0029).

### Abort derives from the session, not the turn — and carries a cancel-guard

This is easy to get backwards. With a non-blocking spawn the parent's turn ends while its child is still
running, so turn-derived abort would kill every child the moment its parent stopped talking. Cascade fires
from the live registry's single teardown path, walking descendants by root.

A cascaded stop sets a cancel-guard over the subtree. The guard is load-bearing here specifically because
delivery wakes finished sessions: without it, a child's own completion notice can revive a tree a person
just stopped. Traycer wrote the same guard, and the fact that they wrote it is the evidence it is needed.

### Delivery is one path with several producers

This is the design's centre, and it is larger than the orchestration work that motivated it.

The question is how anything reaches an agent that is already working. The messaging design answers it
inside stage 3, with a table whose mid-turn row says a message is queued until the turn boundary, called "a
measured ceiling, not a choice." That generalizes a narrower finding than it appears to.

**What a turn actually is.** One turn spans the whole agentic loop — assistant, tool call, tool result,
assistant, and so on until the model stops asking for tools. One round trip is a single request/response
inside it. "Queued to the turn boundary" therefore means *after the agent finishes all its work*, which can
be minutes and dozens of round trips. "The next round trip" means seconds. For a completion notice or a
user steer, that is the difference between useful and useless.

**The ceiling is real but narrow.** [ADR-0012](../../adr/0012-sdk-streaming-input-steering.md) established
live that a message pushed into the Claude SDK's open input iterable is queued to the next turn. That is
confirmed and unchallenged. But it is a fact about **the input stream**, and the input stream is not the
only way into a conversation — a queued user turn has no legal position mid-loop anyway, because the
Messages API requires a tool result to immediately follow its tool call.

**The port already anticipates this.** The runtime adapter carries a reminder-delivery method whose
placement enum is exactly `session-start`, `prompt`, and `post-tool`. Its Claude implementation is a
documented floor that names the enhancement layer it is waiting for: mid-session delivery via `PostToolUse`
or `UserPromptSubmit` additional context. Plan 1 implements that layer. It does not invent a channel; it
fills in one the SPEC specified and left at its floor.

**Both realizations already have their trigger registered.** The pure-API driver injects a pending steer as
a user message at the top of each loop iteration — genuinely between round trips, discarding nothing;
ADR-0012 notes that because coa owns that loop, the pure-API path is ahead of the SDK here. On the Claude
path `PostToolUse` is already registered to drive the change reconciler and currently abstains. Giving it a
return value is a small change to existing wiring, and it fires for every tool including native ones, which
matters because delivery must not depend on which kind of tool the model reaches for.

So delivery is **one intent with a per-backend realization** — exactly ADR-0012's own pattern, an abstract
verdict each strategy realizes inside its own turn model, with no backend branching in core.

| Path | Realization | Reaches a working agent | Discards work |
| --- | --- | --- | --- |
| pure-API | a user message at the next round trip | yes | no |
| Claude | additional context appended to the next tool result | yes | no |
| either, no tool call follows | the close-gate hook, which already exists and lets the conversation continue | at the boundary | no |

The turn boundary stops being the ceiling and becomes the **floor** — the guarantee that delivery happens
eventually, beaten by the round trip whenever the model is doing tool work. Nothing is delivered twice,
nothing is delivered by discarding work, and barge-in is no longer the only way to reach an agent
mid-flight.

**Producers.** Three, of which plan 1 builds two:

1. **User steers.** Today a steer on the Claude path waits for the whole agentic loop, or discards it via
   barge-in. This upgrades it to round-trip delivery, at parity with the pure-API path.
2. **Child-completion notices.** The orchestration work that motivated the path.
3. **Agent-to-agent messages.** Stage 3. Not built, but it inherits a delivery layer that reaches a busy
   agent — something the messaging design had written off as impossible.

**One wrinkle that silently loses user input if missed.** On the held-open Claude path a steer pushed into
the input feed is captured into canonical memory by the streamed-user-turn tap. A steer arriving via a hook
bypasses that tap. It must be recorded explicitly. ADR-0012 is emphatic that the log is the only durable
record of what the user sent.

**A size bound worth knowing before stage 3.** Injected context beyond ten thousand characters is written to
a file and replaced by a preview and a path. Irrelevant for completion notices; relevant for messages.

### Notifications are a channel, not messages

A completion is not a message, and the distinction is worth building in from the start.

**Forgeability.** If a completion rides a message log as a message *from* the child, a child can fabricate
its own completion. A system-authored notification has no such hole. Traycer reserves an unforgeable system
sender id for exactly this reason, having built the agent-shaped envelope first.

**Category.** The messaging design argues messages are not change events because "what changed in the
codebase" and "what agents told each other" are different categories. Read one level finer: a lifecycle fact —
agents told each other" are different categories. The same argument cuts one level finer: a lifecycle fact —
this session ended, it cost this, its transcript is here — is system-authored, structured, and unrepliable.
Traycer's durable log separates message rows from notice rows.

**Reuse.** Completion notices, liveness reasons, a long-running tool that returns immediately, a background
check finishing — one shape. Messaging is the specific thing; notification is the substrate. That design
folded the substrate into stage 3 because it had only one consumer in view.

Plan 1 builds the envelope properly — system-authored with an origin unforgeable by construction, since no
producer API is reachable from a tool handler — with **one producer** (a child session ending) and **three
reasons**, all of them things the daemon observes: completed, errored, stopped. No advisory or inferred
reasons; a signal that cannot be detected is not a signal to emit. In memory for the daemon's lifetime; the
durable log waits for stage 3, where a caller finally needs it.

**Delivery states**, all riding the path above:

| Recipient | Behaviour |
| --- | --- |
| Working | Delivered mid-loop per the table above |
| Idle | Wakes and runs a turn |
| Closed or cancel-guarded | Dropped — never resurrect a stopped session |

### Cost is a record concern

The cap is untouched. The daemon-global wallet already bounds a tree and remains one of only two blocks; no
third blocking surface is introduced, and SC-1 is unchanged.

What plan 1 adds is a **root id in the record**, so audit can answer what a run cost rather than only what
an account spent. The ledger's allow-list is extended by exactly that key.

A child inheriting a fresh copy of the adapter-level per-session ceiling is a bound looser than intended,
never a bypass. It is recorded as a known looseness rather than fixed here.

### The console nests children

Children render **under their parent**, never as un-parented top-level conversations — default-nest, not
default-leak, so a newly-added or unclassified child event is total-classified by construction. The cost
roll-up replaces the current "not tracked yet" floor.

The transcript projection joins parent and child **at read time**, adding no second writer
([ADR-0010](../../adr/0010-append-only-conversation-log.md)).

## Known-unverified

Two facts the plan measures rather than assumes.

**Whether additional context from `PostToolUse` reaches the model within the same turn is not documented.**
The hook fires after a tool completes, and the next model request in an agentic loop is the next round trip
of that same turn, so within-turn delivery is near-certain — but near-certain is not verified, and this is
the subsystem where a prior spike found six of nine assumptions false. It is settled by a live smoke, the
way ADR-0012 established its ceiling. **The design degrades safely:** if injection turns out to be deferred,
delivery falls back to the turn boundary, which is what that design assumed anyway. It is an optimization to
confirm, not a premise to rest on.

**Whether `PostToolUse` fires for every tool including `Bash`.** ADR-0029 lists this as unmeasured. If it
does not fire for some tool, delivery through that tool's boundary is missed and falls back to the floor —
degradation, not breakage, but it should be known rather than assumed.

## Out of scope

- **Discovery** — the agent-list Piece and `find_agent`, which are plan 2.
- **Messaging** — send_message, threads, the inbox, the durable log, and the advisory liveness reasons, all
  stage 3. Not built, and not foreclosed: they become new producers on this delivery path.
- **Authoring** — `author_agent`, stage 4, still gated on an approval channel that does not exist.
- **Demotion and the governance seam** — both shipped under ADR-0029, as recorded above.
- **The thesis rewrite.** AGENTS.md and SPEC §B still state the governance-first thesis superseded by the
  2026-07-31 repositioning. A separate pass.
- **Worktrees for children.** Plan 1 binds none; a child shares its root's tree. Two agents can therefore
  write the same tree. v1 is attended and every write is still governed at the `PreToolUse` seam, so this is
  accepted and named rather than designed away — the worktree manager and concurrent writers arrive with a
  real need.

## Verification

Typecheck clean and the test suite no worse than its known-failure baseline. This repo has **no CI**, so a
skipped or platform-gated test runs nowhere at all; nothing may be gated behind a platform or an environment
flag except the live smokes, which are explicitly opt-in.

In order:

1. The live smoke that settles injection timing and `Bash` hook coverage, before anything depends on either.
2. An unknown agent ref returning an unapplied result naming what exists.
3. A spawn returning an id without waiting for the child to finish.
4. A child's frame **containing** the spawn tool — the depth filter is gone, and this asserts it stays gone.
5. A steer reaching a working agent at the next round trip on both paths, with the Claude-path steer present
   in canonical memory.
6. A completion notice waking an idle parent.
7. A cascade stop that an in-flight notice cannot revive.
8. Two siblings' cost drawing down one wallet, with root-keyed records.
9. The daemon driven re-entrantly against mock adapters — no network.

Then a live smoke: a Claude orchestrator spawns a child on another provider, both appear in one projected
transcript, and a root interrupt cancels the child. Then drive the app: spawn from the console, watch the
child render nested under its parent, and see the roll-up replace the floor.

Fixtures use **mixed** data. A single-item fixture hid a grouping defect through eight reviews on the
previous stage, because the one item was trivially first.

## Decisions to record as ADRs

- **The cost cap replaces the depth cap as the sole fan-out bound**, in its record-only form: the daemon
  wallet already binds a tree, so no new blocking surface is added and SC-1 keeps exactly two blocks.
- **Notifications are a channel distinct from inter-agent messages**, with the forgeability and category
  arguments.
- **Delivery is one intent realized per backend**, extending ADR-0012 rather than contradicting it — the
  input-stream ceiling stands, and a different channel walks around it. This is also the decision that
  raises the reminder-delivery port off its floor.
- **The three-plane model**, of which plan 1 is the first instance.

Plan 1 adds daemon surface the SPEC does not describe — child sessions and the notification channel — so the
same-commit doc rule applies when the code lands.

---

_Last reviewed: 2026-08-05_
