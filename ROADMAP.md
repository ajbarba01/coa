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

- **Bound the fan-out** — nothing limits a spawn tree's width, depth, or spend, and the same absence
  covers agents messaging each other, so a runaway spawn — or a pair of agents talking in a loop —
  is stopped only by the operator or by the provider's own plan limit. The likely shape is a
  user-set ceiling over the spend counter that is already kept, not a revival of the deny path that
  was removed as dead configuration.
- **Persist the orchestration announcements** — a spawn, a completion, and an agent-to-agent message
  are announced on the live stream and never written to the durable log, so a reload shows a
  conversation with no sign that any of it happened. They ride their own live numbering because a
  tool call firing mid-turn would otherwise race the recorder that owns that turn's sequence;
  routing them through the recorder's own drain point is the real fix.
- **Give a peer's message real provenance** — a message delivered by waking an idle session is
  marked as coming from another agent by a bracketed text prefix, because a fresh turn's input has
  no role slot to say so. That is a convention, not a type, so nothing structurally stops an
  adversarial peer from imitating the format.
- **Notice a message that goes unanswered** — a send returns immediately and never carries a reply,
  and nothing ever tells the sender that a thread went nowhere, so a stalled exchange and one still
  in progress look identical from the sending side.

### Spend and accounting

- **Attribute spend per session** — the ledger records every settled charge accurately but carries
  no per-session identifier at all, and the family-tree tag it does carry is stamped only when a
  session has a parent, so a top-level session's own spend is untagged and every sibling under one
  root is indistinguishable from the next. The console's family-tree roll-up is already built,
  already correct, and honestly reads "not tracked yet" because nothing in the runtime can produce
  the numbers it expects. Stamping a session id on every settlement, root sessions included, and
  then aggregating over it, is a data-model change — not the read-verb wiring it was scoped as once
  already, which is how it got mis-sized.
- **Keep the ledger past the daemon's lifetime** — records accumulate in memory for as long as the
  process lives and nothing writes them to disk, so every settled charge is lost on restart.
- **Push spend as it settles** — the stream already defines a spend event and nothing produces one,
  so a surface learns a turn's tokens live but never its cost.
- **Surface real spend where the ceiling used to be** — the counter and the ledger record every
  settled charge, while the read verb that once carried ceiling state answers with a constant.
- **Price the routed provider's models** — default price tables ship for the direct pure-API
  providers, but the provider that fronts arbitrary routed models ships none, so spend through it
  records as zero unless a table is supplied. The same floor applies to any model absent from a
  shipped table. The accounting never guesses a price.

### Sessions and models

- **Warn before a warm cache is thrown away** — the composer's cold-cache notice fires on a staged
  backend change, a staged model change, and a session idle past its provider's cache lifetime, but
  a reasoning-level change discards the same cache and raises nothing.
- **Let the terminal answer a permission ask** — the command-line client subscribes to the daemon's
  push stream and renders turns, status, and cost, but an approval falls through its switch and it
  has no verb to respond with. Since a session's default mode asks before any write or command, a
  session started from the terminal against a model that writes blocks on its first write and never
  proceeds. Read from the code, not observed live.

### The console

- **Surface a permission-mode refusal** — the frame vocabulary carries exactly one kind of stop, the
  close gate, so a refusal that comes from the session's own permission mode reaches the person only
  through whatever the model says next. In read-only mode, where nothing is ever asked, it has no
  surface at all.
- **Measure what a working set of tabs actually costs** — the cap on materialized transcripts is a
  provisional 40, chosen as twice the roughly twenty-tab working set the instant-navigation
  acceptance targets. Nobody has measured what a twenty-tab window really holds in the running app,
  so the number is a placeholder awaiting that measurement, not a settled policy.
- **Add an About section to settings** — the app shows its own version nowhere.

### Extensibility

- **Retry a rate-limited web search** — a rate-limited key goes straight onto cooldown, so a burst
  of searches can come back empty instead of backing off and trying again.

## Later

### Specified and unscheduled

Three features were designed, ruled by the maintainer, and then deferred with their decisions
intact. The requirements below are binding when the work is picked up; visual placement and layout
are free.

- **A read-only viewer surface.** A new app-scoped surface with editor-style tabs, holding files,
  system prompts (per agent, from the frozen compilation), and tool outputs, from any session.
  **Every "view" affordance in coa routes here**: clicking a file path, a truncated tool card's
  "view more", a session's "view system prompt" — each opens a tab and switches to the viewer,
  re-focusing an existing tab rather than duplicating it. Tabs stay materialized, so the
  instant-navigation rule applies to them too. Rendering reuses the transcript's existing code-block
  and syntax machinery; "open in editor" stays the escape hatch. Library-injected skills appear in a
  prompt tab, with its compile time, prompt version, injected-skill count, and drift signal.
  - _Ruled:_ one read verb returning the frozen compilation's text plus its metadata; file viewing
    reads through the existing confinement path, never around it; no editing anywhere; tab state
    lives in the console's own store. The session listing already carries the prompt configuration
    the drift banners read, so the drift signal has a source.
  - _Tests:_ read-verb round trip including drift metadata; routing, per kind of affordance; the
    render path reusing transcript fixtures; confinement, so the viewer cannot read outside the
    session's worktree.
  - _Done means:_ from a transcript, a clicked path opens a file tab, a tool card's "view more"
    opens an output tab, and a child session's system prompt opens a prompt tab carrying its drift
    signal — with every switch instant.
- **Conversation naming and rename.** Auto-naming is ONE model call, off the critical path, after
  the first exchange, on a cheap model reached through the ordinary backend seam. The existing
  deterministic title derivation stays both the immediate title and the fallback. Renaming is an
  inline edit in the session rail and in the browser row.
  - _Ruled:_ an auto-name replaces only an auto-derived title, never a name the user typed — reuse
    the guard that already exists rather than adding a second one; a failed naming call leaves the
    derived title in place, silently.
  - _Reference:_ big-AGI (MIT) for the auto-naming prompt and its timing pattern.
  - _Tests:_ never overwrite a user rename; fall back cleanly on a model failure; the rename verb
    round-trips and survives a restart.
  - _Done means:_ the first exchange auto-titles within seconds; a rename sticks and survives a
    restart; a failed naming call is invisible to the user.
- **A light theme.** A full re-tailored light scale — warm paper-sand grounds, the same brass accent
  identity, a re-tuned state vocabulary — and **never an inverted variant**, because the kit's
  contract is that a theme is one whole file at equal quality. It mirrors the dark scale's complete
  vocabulary (the twelve-step scale, states, agent palette, chart series, syntax, diff, scrim,
  shadows) with light-tuned values, every one re-validated: contrast against the gates the scale
  file documents for itself, and the series and agent palettes re-checked for colour-vision
  separation on the light ground, replicating the validation the dark file already records.
  - _Ruled:_ settings offers dark, light, and system; the OS-follow listener that already exists
    drives the system option.
  - _References:_ Zed (study only — light and dark token discipline), VS Code (MIT — semantic
    token theming), Insomnia (Apache-2.0 — themes as data).
  - _Tests:_ token parity, so every custom property in the dark scale exists in the light one;
    scripted contrast assertions for the text bands against each ground; a showcase screenshot pass
    in both themes.
  - _Done means:_ flipping the setting live-switches the whole console with zero unreadable or
    clipped states, and system mode follows the OS.
  - Deliberately last of the three: it needs the final surface inventory to be worth doing once.

### Surfaces

- **Let a model fork a throwaway workspace** — a spawn can already ask for its own isolated
  checkout, but there is no tool a model can call to enter and leave a scratch workspace inside its
  own session.
- **Longform and graph views** — the reading and relationship surfaces the design calls for do not
  exist yet.
- **Interactive multi-turn in the CLI** — the command line drives one-shot runs, so a conversation
  has to move to the app.
- **Seed a session from a flag** — investigating a flagged problem means starting a session and
  re-explaining it by hand.
- **A plan-then-execute ceremony** — a read-only mode ships, so the separation exists, but nothing
  walks a session from a proposed plan through an approval into execution.
- **Notify outside the window** — a finished turn or a waiting approval is visible only if the app
  is in front of you.

### Honesty and correctness

- **Verify the permission modes end to end** — the four modes (read-only; ask before a write or a
  command; auto-approve edits but ask before commands; ask nothing) are proven at the daemon level
  with adversarially-verified regression tests. The one unmeasured clause is the end-to-end link: a
  real model's tool call reaching the ask, and a person's answer returning, over a live backend. It
  was parked rather than spend live credits on it; the gap is narrow and named.
- **Answer the two unpaid hook questions** — whether the post-tool hook that carries mid-loop
  delivery fires for the shell tool at all (a gated probe is written and unrun), and whether the
  file-changed hook the backend advertises fires at all — it has never been tried, and would be a
  finer trigger for the change reconciler than scanning after every call. Both need real spend, so
  they belong in one deliberate run.
- **Close the library's named gaps** — bounded acceptances it shipped with: one discovered tool
  ecosystem's server configuration is not parsed at all (its skills directory is scanned, its server
  layer waits on a file-format dependency); re-syncing a copied entry rebuilds the record and drops
  hand-added keys every other path round-trips; a library skill whose name collides with a curated
  one silently replaces it in the pullable store; the degrade notice on a backend with no server
  runtime re-emits every turn; server rows drawn from two configuration layers share one source
  identity; and a reference-linked skill's edited body never raises the drift banner, because the
  drift key deliberately covers the selection and not the bodies — copies got a drift indicator,
  references have none.
- **Wire the usage surface to the ledger** — it joins invented spend fixtures onto real credential
  rows, which reads as live data and is not.
- **Finish the error-honesty sweep** — the recent pass caught the loudest silent failures, and the
  quieter degradations should each learn to say so.
- **Tell the model when the gate rewrote its tool input** — governance can reshape a call before it
  runs, and the model sees no sign that it happened.
- **Label advisory checks as advisory** — a notice with nothing actually verifying it should say so,
  rather than reading like a check that passed.
- **Repair a near-miss tool call** — a call that fails on a slightly wrong argument returns the bare
  error instead of a cheap correction.
- **Route duplicate agent definitions through the flag pipeline** — a colliding agent reference
  surfaces only when something happens to read it.
- **Own compaction explicitly** — its moment can be chosen and observed but never vetoed, so the
  transcript should mark the seam and list what survived.

### The console

- **Push flag and drift changes instead of polling** — three reads refresh on a fixed two-second
  interval, so a change can land two seconds late and costs a round trip either way. The stream
  already defines the events; nothing emits them and the console ignores them.
- **Project the active conversation once per render** — the chat surface walks the active session's
  whole frame array to build its view model, unmemoized, while the mounted tab projects the same
  array again inside a memo. Per-frame caches make each element a lookup rather than a rebuild, so
  the cost is one array walk and an allocation — but the surface subscribes to about a dozen keys,
  so it happens often.
- **Keep streaming reconciliation cheap on a long conversation** — folding a batch of streamed
  frames rebuilds the whole array per frame, so a coalesced batch costs on the order of batch size
  times conversation length per animation frame. It is unmeasured, and the append-stable frame
  identity the memoized rows depend on is what constrains any fix.

### Platform

- **Derive RPC types from the method registry** — a verb's request and response shapes are
  hand-mirrored on both ends of the wire and re-validated by hand.
- **A conformance suite for the backend port** — a new adapter is reviewed by eye rather than proven
  against one shared suite every backend must pass.
- **Harden the daemon's endpoint** — the seam for a peer-credential and access-control check is
  marked in the transport and empty.
- **Fill in the remaining console read verbs** — byte-faithful tool and diff fetch, reference
  resolution, conversation search across sessions, and view-scoped live deltas are all missing.
- **Rank file search by relevance** — results come back in scan order rather than weighted by
  recency or churn.
- **Rank the command palette by use** — commands are ordered statically rather than by how often and
  how recently each one is reached for.

## Someday

Direction, bets, and open questions. Nothing here is a build target for the first release, and the
deferred-scope catalogue these were graduated out of lives in the repository's history rather than
in the living doc set.

### The governance era

- **Feed the symbol and graph layer** — the parser and symbol table exist but nothing populates the
  index in production, which is why grounding and reference resolution sit at their floor.
- **Context assembly and sizing** — the context engine detects drift and verifies anchors but does
  not assemble or size a budget, which needs a calibration pass against real attended turns. The
  provisional cut-points that pass was meant to settle were only ever written down in the retired
  design corpus, so it starts from the code's own defaults or from history.
- **Score code health** — the cheap structural signals were built and parked, and they need both a
  caller and the calibration their cut-points were always waiting on.
- **Graph views** — relationship views over the change and symbol graph, once there is a graph worth
  drawing.
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
  blocking ceremony an attended first release downgraded to a visibility floor.
- **Offline operation** — worth building the moment a backend other than Claude becomes primary.
- **Multi-user** — per-user signed feeds, conflict-free merge, and snapshot-isolated gates. A worked
  design and a feasibility survey exist in the repository's history, not in the living doc set.
- **A credential vault** — deferred scope from the beginning: coa records where a credential lives
  and never owns a store of its own, and changing that is a decision, not an increment.
- **One egress chokepoint** — route all network traffic through a single audited module, and promote
  this before any sync, export, or remote-daemon feature ships.
- **Bind prose-bearing memory before anything syncs** — stored prose is a secret surface, so it
  needs a boundary before a ledger or a home directory ever leaves the machine.
- **Anomaly detection over behavior baselines** — log the signal now, detect on it once autonomy
  makes it matter.
- **Self-tuning context profiles** — let accumulated ledger signal set the cut-points that are
  hand-picked today.
- **Model-judged layers** — turn denoising, divergence salience, and flag classification, each gated
  on an experiment that nets positive.
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
- **Rethink the provenance display** — the current presentation is not earning its space and needs a
  design pass rather than a feature.
- **A density scale** — decide which parts of the kit respond to density and how, since the old
  control only ever scaled a type ramp that no longer exists.
- **Nav mini-states** — the account and flag readouts in the nav foot are floors, and what they
  should show is still an open question rather than something to guess at.
- **Constraint authoring** — a lighter path from an observed constraint to a live flag than
  hand-writing producer configuration.
- **A prompt-engineering surface** — somewhere to iterate on and test prompts and roles.
- **Agent-callable summarization and filtering** — tools an agent invokes mid-session to compress or
  judge what it has gathered.
- **Three open design questions** — where the baseline knowledge pieces physically live, at what
  level external tool servers are referenced, and how much tool description to ship for a backend
  that already carries a trained prior.

### Revivals

Parked feature code is catalogued in [archive/README.md](archive/README.md), which records for each
entry what it was, why it stopped being live, and what would have to become true to bring it back.
Nothing there compiles or ships, and reviving one is a decision, not a merge.

## Rejected outright

- **Unattended self-authoring of constraints** — an agent must never turn dismissal statistics into
  its own constraints without a human ratifying each one.

---

_Last reviewed: 2026-08-11_
