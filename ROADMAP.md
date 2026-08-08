# coa roadmap

Everything open, and roughly when. This file is **forward-only**: it records what is not built,
never what already is. For what the system is and how the pieces fit, see `docs/ARCHITECTURE.md`.
Update this file in the same commit as the work that changes it, per the same-commit rule in
[docs/WORKFLOW.md](docs/WORKFLOW.md).

- **Next** — the current focus, picked up in roughly this order.
- **Later** — real and wanted, but unscheduled.
- **Someday** — direction and bets; nothing here is committed.

## Next

### Subagents and orchestration

- **Bound the fan-out** — nothing limits a spawn tree's width, depth, or spend, so a runaway
  spawn is stopped only by the operator or by the provider's own plan limit.
- **Let agents message each other** — a parent and child can exchange only a completion notice,
  so any real back-and-forth needs a message channel with governance of its own.
- **Deliver a child's result, not just its ending** — a parent learns that a child finished but
  has to go find the output itself.
- **Make agents discoverable** — a model must be handed an agent reference, so it cannot pick a
  specialist it was never told about.
- **Roll a tree's cost up to a read verb** — every charge is already attributed to its root, but
  nothing serves that sum to a client.

### Spend and accounting

- **Surface real spend where the ceiling used to be** — the counter and the ledger record every
  settled charge accurately, while the read verb that once carried cap state answers with a
  constant.
- **Ship real price tables for the non-Claude providers** — a model with no configured price bills
  at zero, so a session's recorded spend reads as free unless the user supplies a table through an
  environment variable.

### Sessions and models

- **Give a turn one lifecycle** — each layer tracks "is something running" its own way, and one
  explicit state machine every surface reads would end the disagreements between them.
- **Let the user choose a permission mode** — a session's mode is derived from workspace trust
  rather than chosen, and the daemon should own an explicit per-session decision.
- **Carry real facts on each model** — a model entry has an id, a label, and a reasoning profile
  but no context window, price, or description for pickers and cost surfaces to show.
- **Show context-window usage in the composer** — nothing displays how full a session's window is,
  so the first visible sign of trouble is compaction.
- **Warn before a warm cache is thrown away** — changing the reasoning level mid-session costs the
  prompt cache, and the existing cold-cache notice says nothing about it.

### The console

- **Rewrite the store around push-fed slices** — a poll tick or a streamed frame republishes the
  whole console state, so every subscribed surface re-renders regardless of what actually changed.
- **Materialize tabs so navigation is instant** — switching surfaces mounts content behind a
  spinner instead of revealing a canvas that is already there.
- **Make attachments real** — the composer's attach control is a permanently disabled placeholder
  and inline file references do not exist.
- **Search inside a conversation** — the session browser searches across sessions, but there is no
  way to find text within one transcript.
- **Add an About section to settings** — the app shows its own version nowhere.

### Extensibility

- **Build the skills and MCP library** — there is no way to install a skill or an MCP server,
  browse what is installed, or attach either to a role or an agent.
- **Retry a rate-limited web search** — a rate-limited key goes straight onto cooldown, so a burst
  of searches can come back empty instead of backing off and trying again.

## Later

### Surfaces

- **A viewer for what was actually sent** — the assembled system prompt, context, and tool set a
  turn ran with are not inspectable from the app.
- **Worktree manager** — a subagent writes in its parent's working tree because nothing hands a
  session its own, and forked throwaway workspaces wait on the same seam.
- **Name conversations from their content** — a session stays titled by its first message forever.
- **A light theme** — one dark scale ships, and the theme control was removed rather than left as
  a visible no-op.
- **Longform and graph views** — the reading and relationship surfaces the design calls for do not
  exist yet.
- **Interactive multi-turn in the CLI** — the command line drives one-shot runs, so a conversation
  has to move to the app.
- **Seed a session from a flag** — investigating a flagged problem means starting a session and
  re-explaining it by hand.
- **Plan mode** — there is no research-then-execute separation inside a governed session.
- **Notify outside the window** — a finished turn or a waiting approval is visible only if the app
  is in front of you.

### Honesty and correctness

- **Wire the usage surface to the ledger** — it joins invented spend fixtures onto real credential
  rows, which reads as live data and is not.
- **Finish the error-honesty sweep** — the recent pass caught the loudest silent failures, and the
  quieter degradations should each learn to say so.
- **Tell the model when the gate rewrote its tool input** — governance can reshape a call before it
  runs, and the model sees no sign that it happened.
- **Label advisory checks as advisory** — a notice with nothing actually verifying it should say
  so, rather than reading like a check that passed.
- **Repair a near-miss tool call** — a call that fails on a slightly wrong argument returns the bare
  error instead of a cheap correction.
- **Route duplicate agent definitions through the flag pipeline** — a colliding agent reference
  surfaces only when something happens to read it.
- **Own compaction explicitly** — its moment can be chosen and observed but never vetoed, so the
  transcript should mark the seam and list what survived.

### Platform

- **Derive RPC types from the method registry** — a verb's request and response shapes are
  hand-mirrored on both ends of the wire and re-validated by hand.
- **A conformance suite for the backend port** — a new adapter is reviewed by eye rather than
  proven against one shared suite every backend must pass.
- **Finish the composition-root cleanup** — construction has largely moved to the root, and what
  still assembles its own dependencies on the side should follow.
- **Harden the daemon's pipe** — the seam for a peer-credential and access-control check is marked
  in the transport and empty.
- **Give the CLI a build script** — it only typechecks, so nothing can auto-spawn a built daemon.
- **Fill in the remaining console read verbs** — byte-faithful tool and diff fetch, reference
  resolution, conversation search, and view-scoped live deltas are all missing.
- **Rank file search by relevance** — results come back in scan order rather than weighted by
  recency or churn.
- **Rank the command palette by use** — commands are ordered statically rather than by how often
  and how recently each one is reached for.

## Someday

### The governance era

- **Feed the symbol and graph layer** — the parser and symbol table exist but nothing populates the
  index in production, which is why grounding and reference resolution sit at their floor.
- **Context assembly and sizing** — the context engine detects drift and verifies anchors but does
  not assemble or size a budget, which needs a calibration pass against real attended turns.
- **Score code health** — the cheap structural signals were built and parked, and they need both a
  caller and the calibration their cut-points were always waiting on.
- **Graph views** — relationship views over the change and symbol graph, once there is a graph
  worth drawing.
- **Graph depth** — call and inheritance edges, cycle detection, and a temporal projection, all of
  which staleness and health scoring would sit on.
- **Turn-level undo** — the retention floor and working-tree rewind were built and parked, waiting
  on a control that would ever invoke them.
- **Spec conformance** — regenerate a declared target and check a symbol against the constraints
  governing it, revived only once something in production writes the authority edge.
- **Flag auto-fix and reminders** — a flag's deterministic fix applied as a revertible patch, and
  the single most authoritative rule re-surfaced before the agent slips past it.
- **Boundary advisories** — warn when a dependency crosses an architectural boundary the project
  declared, and never block on it.
- **Semantic contradiction detection** — the meaning-level half of grounding, once capture and the
  binding from symbol to decision both exist.

### Bets

- **A rigor dial** — named presets over the individual governance controls, so the whole posture
  moves at once instead of knob by knob.
- **Cross-repo memory** — one developer, many repositories, one private index.
- **A standing adversarial reviewer** — the explicit gate before any unattended autonomy.
- **The autonomy stack** — escape-gate policy, relaxation, per-session process isolation, and the
  blocking ceremony an attended v1 downgraded to a visibility floor.
- **Offline operation** — worth building the moment a backend other than Claude becomes primary.
- **Multi-user** — per-user signed feeds, conflict-free merge, and snapshot-isolated gates, with a
  worked design and feasibility survey already behind it.
- **One egress chokepoint** — route all network traffic through a single audited module, and
  promote this before any sync, export, or remote-daemon feature ships.
- **Bind prose-bearing memory before anything syncs** — stored prose is a secret surface, so it
  needs a boundary before a ledger or a home directory ever leaves the machine.
- **Anomaly detection over behavior baselines** — log the signal now, detect on it once autonomy
  makes it matter.
- **Self-tuning context profiles** — let accumulated ledger signal set the cut-points that are
  hand-picked today.
- **Model-judged layers** — turn denoising, divergence salience, and flag classification, each
  gated on an experiment that nets positive.
- **Mined constraints** — propose constraints from dismissal and friction statistics, always with a
  human ratifying each one.
- **Grounding extensions** — stub-grounding external symbols, a headless language server for user
  projects, and per-language documentation generators.
- **Guard against poisoned provenance** — author-declared origin claims can mislead grounding, so
  trusting one needs a check behind it.
- **Backend capability negotiation** — revive the port manifest when adapters differ enough that a
  uniform port stops being honest.
- **Role and capability enforcement** — make a role's computed capability frame physically binding,
  so a documentation role cannot reach code.
- **The project charter as a loaded piece** — agents pick up this repository's own operating rules
  the way the harness picks up its instructions file.
- **Mirror specific harness behaviors** — worth scoping once the maintainer names which ones.

### Product and design questions

- **Reach** — a web or remote inspector, an ambient dashboard, cross-session cost analytics, shared
  team configuration, and voice or image input, each waiting on the force that would justify it.
- **Rethink the provenance display** — the current presentation is not earning its space and needs
  a design pass rather than a feature.
- **A density scale** — decide which parts of the kit respond to density and how, since the old
  control only ever scaled a type ramp that no longer exists.
- **Nav mini-states** — the account and flag readouts in the nav foot are floors, and what they
  should show is still an open question rather than something to guess at.
- **Constraint authoring** — a lighter path from an observed constraint to a live flag than
  hand-writing producer configuration.
- **A prompt-engineering surface** — somewhere to iterate on and test prompts and roles.
- **Agent-callable summarization and filtering** — tools an agent invokes mid-session to compress
  or judge what it has gathered.
- **Three open design questions** — where the baseline knowledge pieces physically live, at what
  level MCP servers are referenced, and how much tool description to ship for a backend that
  already carries a trained prior.

### Revivals

Parked feature code is catalogued in [archive/README.md](archive/README.md), which records for each
entry what it was, why it stopped being live, and what would have to become true to bring it back.
Nothing there compiles or ships, and reviving one is a decision, not a merge.

## Rejected outright

- **Unattended self-authoring of constraints** — an agent must never turn dismissal statistics into
  its own constraints without a human ratifying each one.

---

_Last reviewed: 2026-08-08_
