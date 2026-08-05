# Inter-agent messaging and non-blocking dispatch

Revises the dispatch half of [the agent registry and subagent dispatch design](./2026-08-04-agent-registry-and-subagent-dispatch-design.md).
That design's registry half stands unchanged; its dispatch half assumed a parent waits for one child to
finish, and that assumption does not survive contact with agents that can talk back.

Informed by [the Traycer spike](../../design/research/2026-08-04-traycer-orchestration-spike.md), which
read a shipping cross-provider orchestrator with a mature agent-to-agent layer and no governance layer at
all. Where this design borrows, it says so; where it deliberately diverges, it says why.

## What this changes

The registry — named, described agent definitions, merged across built-in, personal and project scopes —
is needed identically under this design. **Nothing here touches it.**

Four decisions in the prior design are revised:

- **`spawn_agent` no longer waits.** It returns once the child has started. The success of a spawn is that
  the subagent began, not that it finished.
- **The depth cap is dropped**, and with it the whole depth-at-assembly mechanism: no `depth` on the
  assembly context, no filtering `spawn_agent` out of a child's resolved frame, no conditional derivation
  of the agent-list Piece. A child may spawn.
- **Addressing is a mesh** within a root's family tree, so hierarchy becomes provenance rather than
  permission.
- **Cost is attributed to the root.** Every agent beneath a root draws on one budget.

And one capability is added that the prior design had no need for: a **live roster**. The registry answers
"what could I spawn"; the roster answers "who is running in my tree right now, and what are their ids".
Both are needed, and they are different reads.

## Decisions

### Dispatch is non-blocking

`spawn_agent` returns an agent id as soon as the child starts. A parent learns that a child finished the
same way it learns anything else — a message.

The prior design said `description` and `prompt` "mirror Anthropic's `AgentInput` verbatim, carrying the
trained prior for free." That mirroring now applies to the **input shape only**. Task-shaped tools carry a
trained expectation that the call returns the subagent's final report, so the tool description must state
plainly that it returns an id and results arrive as messages. Otherwise the model waits for a report that
never comes.

This is not a novel position. The harness coa is built against has already moved the same way: subagents
run in the background by default and completion arrives as a notification, with synchronous execution as
an opt-in.

### A blocking spawn cannot coexist with an inbox

Worth recording as the reason, because it is not obvious. If a parent parks inside `spawn_agent` waiting
for a result, it is not reading its inbox. A child that stops to ask a clarifying question then waits on a
parent that cannot answer, and the parent waits on a child that cannot proceed. Both hang.

Traycer never encounters this because nothing in their system blocks — every send returns immediately.
That is not incidental; it is what makes a mesh coherent. Their liveness machinery addresses the *other*
failure, where nobody replies.

### Addressing is a mesh within the root's family tree

A root session and every agent descended from it form one address space. Within it, any agent may address
any other. Parent and child is lineage for the record and the UI, not a permission boundary.

Traycer reaches the same place through an explicit container object (a Task, internally an *epic*), and
their docs are explicit that "hierarchy is provenance only". coa does not need the new object: the root
session already bounds the set, and it is the same boundary cost attribution wants. Two unrelated runs
cannot address each other.

### The inbox belongs to the daemon, with its own durable log

Sessions are the daemon's already, so an inbox there introduces no new sideways call between modules —
the change-kernel invariant is about the module graph, not about routing every runtime datum through it.

Messages are **not** change events. The change kernel is the source of truth for what changed in the
codebase; conversational traffic is a different category and putting it there would bloat the spine with
data no consumer of "what changed" wants.

The log is append-only and durable, separate from the spine. Traycer's live queues are RAM-only and they
still had to build a separate append-only log, because for some message paths that row is the only durable
record of what agents told each other. Building the durable form first avoids retrofitting it.

### Delivery follows receiver state

| Receiver state | Behaviour |
| --- | --- |
| Idle | Pushed into the session's input stream; the agent runs a turn |
| Mid-turn | Queued; lands at the turn boundary |
| Finished | Wakes and runs again |
| Not yet started | Queued until it starts |

The mid-turn row is a measured ceiling, not a choice. coa established live under
[ADR-0012](../../adr/0012-sdk-streaming-input-steering.md) that the Claude
Agent SDK exposes no primitive to inject into a running turn: a pushed message is queued and runs at the
next boundary. Delivering sooner requires interrupting, which discards the in-flight work. There is no way
to deliver now *and* keep the work, and no inbox design can conjure one.

Waking a finished agent makes replies reliable — a reply that arrives just after its recipient wrapped up
still lands — and makes follow-up work possible without respawning an agent that has lost its memory. The
risk that something thought done starts spending again is bounded by the root cost cap.

### Liveness is reported, with graded confidence

Because sends do not block, a sender expecting a reply can wait indefinitely. When a thread goes quiet the
sender is told **why**: the receiver's turn ended without replying, its process exited, it errored, a
person stopped it, it is parked waiting on a human, or it was cancelled and the thread is dead.

The discipline worth copying from Traycer is that each reason carries its own confidence. A turn-ended
signal derived from a stop hook is trustworthy; a "gone quiet" signal derived from silence is a guess and
must be marked as one, because the receiver may still be mid-turn. A cancelled thread must further tell the
sender not to re-send or spawn a replacement.

### The root cost cap is the only bound

Every agent under a root shares the root's budget. A message loop provokes turns, turns cost money, and
the cap stops it. This keeps SC-1 intact at exactly two blocks, and it bounds failure modes nobody
predicted — which a depth counter cannot.

Traycer has no bound of any kind, and the cost shows in their code: a list renderer that emits `[cycle]`
rather than looping, and a cascade-stop guarded so a killed subtree cannot revive itself. Those are
artifacts of having no backstop. coa already has one.

### Messaging is governed at the seam that already exists

`send_message` and `spawn_agent` are ordinary coa tools, so `PreToolUse` governs them exactly as it
governs everything else — deny or abstain, never grant, per
[ADR-0029](../../adr/0029-one-bounded-tool-surface-governed-at-one-seam.md). No new governance seam, and
the deny channel is unchanged.

## What is not built

- **No read-inbox verb.** Traycer needs one because their delivery surface truncates large payloads;
  coa's push does not.
- **No transcript reads between agents.** Ask by message instead. Revisit if asking proves insufficient.
- **No role claims.** Traycer's advisory self-claimed roles are a good idea for larger meshes; nothing in
  the current use cases needs them.
- **No cross-machine messaging.** coa is local-first and single-user.
- **No explicit container object.** The root session is the container.

## Dependencies

The orchestration slice must land first — child sessions, parent links, and abort derivation are its
output and this design consumes them. Root cost attribution is new work in governance and audit, which
caps per session today.

## Staging

1. **Registry promotion** — unchanged from the prior design, and unaffected by anything here. Still the
   prerequisite for everything.
2. **Discovery and dispatch** — the derived Piece, `find_agent`, and `spawn_agent` with live validation.
   The depth-override work is deleted rather than built. Root cost attribution joins this stage, because
   the moment a root can have children the per-session cap is the wrong unit.
3. **Messaging** — the durable message log, `send_message`, the `list_agents` roster, the four delivery
   states, and the liveness notices.
4. **Authoring** — `author_agent`, unchanged, still gated on the approval channel. Agent-to-agent messages
   and human approvals stay distinct channels, though the liveness vocabulary references approvals when it
   reports an agent parked waiting on a person.

## Verification

`pnpm typecheck` and `pnpm test` green at each stage; the baseline known-failure state may not grow.

Stage 2: a spawn returns an id without waiting for the child to finish, and a child's frame contains
`spawn_agent` — the depth filter is gone. Cost from two sibling agents accrues against one root budget.

Stage 3: a child asks its parent a question and receives an answer without either side hanging. A message
to an agent that already finished wakes it. A sender whose thread goes unanswered receives a notice naming
the reason, and a reason derived from silence is marked as advisory where one derived from a stop hook is
not. A message loop is stopped by the root cost cap.

Then drive the app: spawn two agents from one session, have them report back, and answer a question from
one of them — in one run, without a restart.

## Decisions to record as ADRs

- **The root cost cap replaces the depth cap as the sole fan-out bound.** The reasoning leans on SC-1's
  two-blocks rule and is the thing a future reader will most want explained.
- **Inter-agent messages ride a daemon-owned durable log, deliberately not the change spine**, with the
  category argument for why a message is not a change event.

Both add surface to the daemon that the SPEC does not describe today, so the same-commit doc rule applies
when the code lands.

---

_Last reviewed: 2026-08-04_
