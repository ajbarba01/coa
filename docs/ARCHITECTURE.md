# Architecture

> What coa **is today**, subsystem by subsystem, under the real package names. This describes the tree as
> built, not a plan: where a capability is missing, it is named as missing. Build order, package boundaries and
> the dependency ruleset live in [REPO_LAYOUT.md](REPO_LAYOUT.md); remaining work lives in
> [ROADMAP.md](../ROADMAP.md).

coa is a local-first, single-user layer around a rented coding-agent loop. It does not implement the agent: it
composes the prompt, owns the tool surface, records what happened, keeps the conversation, and streams the
result to a console. A resident **daemon** owns everything durable; every client — the CLI and the Electron
console — is a thin, reattachable viewer over a JSON-RPC endpoint.

---

## The shape of it

`packages/core` **is** the daemon — the change-event spine plus the rings around it (flags, context, the config
compiler, the workbench, governance, models, auth, sessions, JSON-RPC). `packages/shared` holds the types and
schemas everything validates against and imports nothing itself. `packages/spi` holds the backend port types
with no implementations; `packages/loop-driver` and the two adapter packages sit behind them.
`packages/code-intel` turns bytes into structure. Three console packages (view model, kit, transcript) are pure
renderer-side libraries. `apps/cli` is both the `coa` binary and the daemon's composition root; `apps/desktop`
is the Electron console. `archive/` holds parked feature code that nothing compiles or imports.

Three structural rules hold the graph together, all machine-checked (the ruleset itself is documented in
[REPO_LAYOUT.md](REPO_LAYOUT.md)):

- **The change-event spine is the only shared mutable substrate.** Inside `core`, every ring imports the spine
  and `shared` — never a sibling ring sideways. Two hubs are exempt because their whole job is composition: the
  session layer and the JSON-RPC layer.
- **The backend fan-in is injected, never imported.** Only `apps/cli` and the adapter packages may name an
  adapter package or the loop driver. Everything else receives a constructed backend through port types.
- **The rules are kept honest, not decorative.** Their failure mode is silence — if cross-package imports stop
  resolving to source, every cross-package rule quietly stops matching and the check keeps reporting green. So
  a canary test plants deliberately-forbidden edges (renderer to core, kit to transcript, a neutral package to
  an adapter) and asserts each is reported. The ruleset cannot go decorative without a red test.

### Invariants that bind every subsystem

- **Strict superset.** Every feature either adds value or degrades to a literal pass-through. coa sits between
  a person and a loop it does not own, so "not built yet" and "not configured" must never make the governed
  loop worse than running the agent bare. This is enforced independently at each layer: an empty producer set
  leaves the flag pipeline inert, an unconfigured summarizer degrades the fetch tool to raw markdown, no
  registered accounts means byte-identical ambient auth, and the console's raw mode reprojects the daemon's
  frames verbatim.
- **One block.** The close gate — a governed "you're not done yet" at turn end — is the only thing in the
  system that can stop the agent. It is issued through a single seam.
- **The core never names a backend.** It asks capability questions with defined null-fallbacks; it never
  branches on which backend is running.
- **No model call on a critical path.** Every governance decision — the gate, the per-tool check, path
  confinement, generation drift — is synchronous and deterministic.
- **External data is parsed at the edges.** `shared` owns the Zod schemas; wire, config file, and IPC
  boundaries validate before anything downstream sees a value.

---

## Daemon and sessions

`coa serve` stands up the daemon. `apps/cli` is its composition root: it constructs the daemon singletons in
dependency order (the change kernel, then the flag pipeline, then governance, with the prompt compiler and the
governed tool catalogue bound by reference), builds the concrete backend factory and the inspector/auth handler
map, and binds a JSON-RPC endpoint — a Windows named pipe, or a Unix domain socket under the runtime directory.
The transport frames NDJSON over any duplex, so the protocol layer is independent of the endpoint kind. Endpoint
hardening (Unix peer-credential rejection, a Windows DACL) is **not** applied; the seam where it belongs is
marked in the transport, and closing it is a precondition for any multi-user or remote-daemon mode.

**The daemon owns a live session; a connection is only a viewer.** A conversation's liveness belongs to the
daemon's live-session registry, never to whoever started it. One session service — constructed once, beside the
registry and the conversation store — is the single owner of live-session lifetime. `send` is
send-or-create: it resolves or mints the conversation id, queues the request as a turn, and (only the first
time) starts a daemon-owned loop that drains that queue one turn at a time. Every later send, from any client
over any transport, rides the same loop. Nothing caller-scoped is stored on the service; a turn's own facts —
the role it asked for, the sink it wants hydrated, the answer it is waiting on — travel *with* the queued turn,
because state kept privately by the founding caller would be invisible the moment a second client sent the next
turn. A live session runs headless with zero subscribers, and a reattaching client is hydrated with the
daemon's true current run status rather than reconstructing liveness from stale client memory.

Two **drive strategies** sit behind one contract, chosen per provider by the composition root:

- **Held-open** (Claude): one backend query stays alive across a session's turns, fed successive user turns as
  a stream. Warm continuation, no resume replay. A mid-conversation model or prompt-config change
  re-establishes the query rather than silently continuing on the old pinned prompt.
- **Per-turn** (every pure-API provider): a fresh governed loop per turn.

Both record through **one frame recorder** — the single place a turn's frames become visible. It pushes to
subscribers and appends to the durable log, so the rules that must hold for both strategies exist once:
streaming deltas are pushed but never persisted, a delivery's log line is written where the model actually
received it, and a settled reasoning block carries its wall-clock. A shared per-turn prelude does the rest of
the durable work: mint the conversation if new, decide how the model regains its memory, reuse or recompile the
frozen prompt, pin the effective model selection, append the user's prompt.

**One append-only conversation log per session.** A conversation persists as a single growing `events.ndjson`
under a gitignored per-session directory; the UI view and the provider-shaped transcript are both **read-time
projections** of it. The earlier two-store shape (an incremental UI file plus a canonical transcript rewritten
on clean settle) made integrity a per-call-site flushing discipline and produced disk/conversation divergence
on a mid-turn error. With one log that only grows, integrity is structural — a crash cannot persist an
inconsistent state. Unpaired tool calls are repaired at read time (a synthesized interrupted-execution result;
orphaned results dropped) so cross-provider replay stays valid. Reads never throw: a corrupt session index
drops that session from the listing and a garbage log line is skipped — and what was dropped is **counted and
reported**, because a conversation that lost part of its record must not come back looking whole, either to the
console or to the model being handed its own memory.

**Streaming deltas are delivery-only.** The pure-API completion primitive is an async generator: it yields text
and reasoning deltas and *returns* the settled result, so a non-streaming backend degrades for free by yielding
nothing. Delta frames reach the UI but never the durable log — zero appends during a stream, exactly one at
settle. A mid-stream interrupt keeps the accumulated partial, marked interrupted, as one settled frame.

**Mid-turn delivery is one intent realized per backend.** "Text waiting to reach a running loop" is a neutral
queue with a provenance tag (`user` or `system`); each adapter drains it at its own soonest legal boundary and
the core never asks which backend it is talking to. On Claude the only legal mid-loop position is beside a tool
result — the API forbids a bare user message between a tool call and its result — so the post-tool hook carries
pending text as additional context, with the stop hook as the floor for tool-free turns; the pure-API loop
drains at the top of each round trip. A delivery stranded past the last drain point degrades to a plain next
turn: never lost, never a hang. Sealing the queue is a one-way cancel guard, so a delivery arriving after
teardown can never wake a subtree a person deliberately stopped. The `system` origin is unforgeable **by
reachability, not convention** — no tool handler ever receives a session handle capable of authoring one.

**A steer is recorded when the model receives it.** Its log line is written at *drain*, not at send: held while
any tool call is open and written the instant the last one closes. A send-time record claimed a transcript
position that never happened and could land inside a tool-call/tool-result pair, an illegal shape that
corrupted cross-provider replay. The rule is phrased as the legality constraint — hold while a tool call is
open — precisely so it stays correct regardless of unmeasured hook-timing facts. One writer, in the core, for
every backend; an unbalanced turn flushes held lines at the boundary, and a sealed queue is never drained, so
an undelivered steer is never recorded. Barge-in was removed outright: a steer always delivers at the next
possible boundary and never discards in-flight work. Discarding a turn is an explicit stop-then-send.

**Prompt freezing and memory.** Provider caching is a prefix match, so any byte change in the prefix
invalidates everything after it. A session compiles its system prompt once, at the first turn, and every later
turn reuses that frozen compilation verbatim — the neutral config plus the capability frame it was built with,
since tools are part of the cached prefix too. Recompiling is a deliberate, user-raised act surfaced as a drift
notice, not a per-turn side effect. How the model regains memory is decided per turn against the same canonical
fold of the log: a same-provider Claude continuation resumes the backend's own server session by id (the
strongest cache guarantee, eligible only while the live provider and model still match the stamp the token was
captured under); a pure-API backend replays the neutral transcript as history messages; a cross-provider switch
*into* Claude delivers the transcript as a first-turn preamble, because the SDK cannot ingest a foreign
transcript into its own store. After that turn Claude owns a resumable session again.

**Subagents are ordinary sessions with a parent link.** A spawned child is created through the exact same path
as any session, carrying two optional fields — `parent` and `root` — and nothing else distinguishes it.
Everything a session already has (idle eviction, the single teardown path, cost settlement, the append-only
log) is therefore free, with no new state to synchronize, and an ordinary session's on-disk shape is unchanged
because absent lineage writes no keys. Lineage is a single stored pointer; the descendant walk rebuilds the
tree on demand and carries an explicit visited set, so the stop cascade provably terminates on any graph shape
— the depth cap was dropped deliberately, so a parent chain can point anywhere, including back up its own
ancestry. Abort is wired at the session-lifecycle seam (seal the queue, close the session), not the turn seam,
so it works mid-turn, between turns, or before the first turn, on every backend. A spawn against a dead parent
orphans the child rather than refusing it — a refusal would need a throw or a lying success — and the orphan
runs its turn and self-cleans via idle eviction. Accepted risk: a child shares its root's worktree, so two
agents can write the same tree concurrently; the product is attended and every write still passes the gate.

**A completion notice is a fact, not a message.** When a child ends, its parent receives a daemon-authored
lifecycle fact — child id, agent ref, one of three *observed* reasons (completed, errored, stopped), and a
bounded, sanitized error detail — never the child's own text. If the notice were child-authored, a broken or
adversarial child claiming "done" would be indistinguishable from an observed fact in the parent's context.
There is deliberately no inferred reason such as "went quiet": a signal that cannot be detected must not be
reported as one. The notice rides the same delivery queue as everything else, and the parent retrieves the
child's actual work itself by reading the child's log with its ordinary file tools. Agent-to-agent messaging is
deliberately not built, so its trust model is not inherited from this narrower channel.

Teardown has exactly one path. Idle eviction, the explicit close verb, and daemon shutdown all route through
the same registry close, which is where the spine checkpoint and the worktree release happen — once, never
twice. Idle eviction is running-aware and never fires on a live turn.

---

## Event spine and reconciler

The **change kernel** in `packages/core` is the narrow waist: one append path, a single-writer write-ahead log,
a synchronous in-memory graph update, then the projection. On startup it replays the log to rebuild every
projection — the log is the source of truth and everything else is derived. A checkpoint timeline is read over
it and surfaced as the console's Timeline surface.

Two producers fund it:

- **The precise-write producer.** coa's own write and edit handlers emit change events directly, so there is
  never a second write path that could drift from the spine.
- **The reconciling producer.** After tool activity, a git-centric scan finds what changed on disk, hashes to
  dedup coa's own precise writes into a confirmation, and respects `.gitignore` for free. Rather than parsing
  per-tool inputs, one trigger covers a native edit, a write, and anything a shell command touched — the same
  facts reach the spine whichever loop is running, because both adapters call the trigger at their own tool
  boundary.

The reconciler is constructed **eagerly and guarded**. Eagerly, because its constructor seeds each tracked
file's prior hash from git — deferring construction to the first tool call would seed the baseline from
already-modified disk, so the first edit to a tracked file would read as no change at all. Guarded, because the
git probe throws outside a worktree, and coa must work on any project. That expected failure is silent (its
stderr is captured, not inherited, so a non-git project does not print a scary line); it degrades observation
to a no-op and the session runs exactly as it would with no git at all.

A failure *once observation is running* is the opposite case and is treated as such. A few consecutive scan
failures are tolerated and retried, because the usual causes — an index lock held by another command, a file
disappearing mid-scan — clear on their own, and a successful scan clears the streak. Past that tolerance
observation latches off, since re-running a scan that keeps failing spawns a git process per tool call for
nothing — and the latch **announces itself** as an advisory notice on the flag feed, because the symptom is
otherwise invisible: edits made outside coa's own tools simply stop being recorded.

---

## Flags and the close gate

One pluggable pipeline, one shared flag schema, no per-producer side channels. Registration is the only
add-path and is gated by a validation stamp — an unvalidated producer is rejected rather than admitted.
Ingestion is the only emit-path. On read the pipeline deduplicates by concern, assigns two independent axes
(severity and confidence), and fans out to two audiences: the person sees everything, with low-severity
concerns collapsed-but-counted rather than hidden; the agent gets a gated, grouped injection of only
high-confidence, high-severity items, with the rest riding a count line. A typed-reason triage channel records
*why* a flag was acted on or dismissed and applies the deterministic effect (a wrong guess resolves it, a
won't-fix baselines it). Prose-bearing notes stay local to the spine and never enter the audit ledger.

Producers are driven off the kernel feed. The pipeline owns a projection, so it subscribes from cursor zero and
replays history before going live. A **reconciling** producer — one that emits its complete current set — is
driven differently: the driver tracks the fingerprints that producer last emitted and resolves any it no longer
emits, which is the self-heal, and runs one convergence sweep at wiring so state already dangling at startup
surfaces even with no change events. Per-producer tracking keeps the diff scoped and never touches another
producer's flags. With no producers configured the pipeline is inert: the gate allows and nothing fires.

**The close gate is the only block in the system.** It fires at turn end when unresolved high-severity,
may-block concerns exist, and it does not stop the agent — it keeps the loop open and feeds its reason back so
the agent keeps working. It is issued through a single seam alongside the per-tool check, so auditing "can coa
ever stop me" is a one-line answer instead of a system-wide search. The per-tool advisory-to-deny rules ride
the same seam but are explicitly demotable pipeline policy, not a second standing block: the predicate is
first-deny-wins and **fails closed** on a throw, refusing rather than admitting an unchecked call. Backends
hold no policy — they only run the predicate the core assembles. Today no production path registers a per-tool
deny rule, so that channel is wired end to end and never fires; the deny machinery exists for the rules a later
governance pass would add.

The context layer feeds the pipeline with deterministic producers. The generation-drift producer regenerates a
declared target from its source using the pinned generator, canonicalizes both the fresh output and the
checked-in copy through the parser, and byte-compares: different means a may-block, auto-patchable staleness
flag; identical means pass, at zero tokens and zero judgment. Soundness is proven before it is claimed — at
construction each relation runs a reproducibility self-test, and a relation whose generator is
non-reproducible, whose output is binary, or which cannot be canonicalized is **refused** a blocking constraint
and handed instead to a detection-only producer that raises an advisory "eyeball this" notice. coa never ships a
blocking check it cannot prove.

---

## Workbench: tools and confinement

The workbench is both a producer (it writes through the spine) and the outer-ring tool surface. Its catalogue
is a manifest partitioned by schema cost: a small always-loaded kernel set (the localized diff edit, the
whole-file patch escape, and the subagent spawn) and an on-demand set discovered and pulled in when needed.
The symbol-reading verbs are implemented but deliberately **unregistered** — the index they read has no
producer feeding it, so they could only return empty results; they rejoin the catalogue when that layer is fed.

One dispatch boundary turns pure handlers into registered tools. It is where the two cross-cutting rules land:
inputs are schema-validated before a handler touches shared state, and every return is decorated with the
gated, agent-audience flags. Dispatch **never throws and never denies** — a malformed input, a confinement
rejection, or a failed diff comes back as a typed unapplied result the agent can read and retry. Each tool also
carries its own display renderer and success predicate, because the tool owns its result shape and a pure-API
loop has no backend-supplied result text or error signal.

**Path confinement** is the load-bearing precondition. coa's in-process tools are not covered by any backend
sandbox — deny rules bind built-in and shell tools, not custom in-process ones — so every handler runs a
deterministic check before touching disk: resolve symlinks, reject anything that escapes the session worktree
(a parent traversal, an absolute path, a symlink pointing out), then reject anything matching the forbidden set
(coa's own local directory plus any injected deny globs). The math runs in POSIX path space because the spine
addresses files with forward-slash worktree-relative paths, so it is deterministic and OS-independent; a
Windows drive-letter root is mapped into that space for the traversal and the result rebuilt from the original
root so it stays openable.

**Two independent gates must never collapse into one:** "does this backend have an executor behind this tool
name at all" is a composition-time fact, and "may this session call it" is the capability frame plus the
permission predicate. They answer different questions.

### The pure-API tool floor

Thin backends are bare chat APIs — no executor exists behind a tool name unless coa supplies one — so on that
path coa owns the file tools (read, glob, grep, write, edit, bash) and the web tools, while the Claude path
keeps the vendor's better-integrated equivalents. The disk and process halves live beside the workbench and are
bound by the composition root; the shell is resolved once per session, so a model's POSIX one-liners get a
POSIX shell on Windows where one is present. Named deviations, accepted for an attended single-user product:
the shell tool is confined to the worktree working directory, output-capped and time-boxed, but has no OS
sandbox — parity with the vendor's own shell — and web domain filters are forwarded to providers rather than
enforced locally. Writes fund through the one spine emit path, so a thin-backend write is exactly as observable
as any other.

**Web egress** is credential-gated and cooldown-aware: search and fetch each run a chain of providers degrading
to a plain-fetch floor, with a shared classifier separating a rate limit from a real failure and a key-state
store holding cooldowns. Provider keys live as credential-blind pointers in a user-global config plus
mode-0600 key files, the same pattern as account auth. The chains and the fetch summarizer are assembled in
`apps/cli` and injected as finished dependencies, so the core stays backend-blind and never reads the process
environment. No configured keys means the two tools are simply not offered; deps without a summarizer still
offer fetch on its raw-markdown floor. Degradation, never an error.

**Subagent dispatch** is an ordinary tool. It resolves an agent ref against the live registry — read per
dispatch, never a list cached at session start, so an agent authored moments ago is spawnable immediately —
starts the child and returns its id **immediately**, without waiting for the child's work. It holds no
governance surface of its own; the per-tool seam gates it like every other call. Everything it echoes back to
the model (a model-chosen ref, an agent's name or description from a hand-authored file) is flattened through
one shared sanitizer and length-capped, so a hostile or merely huge string stays inert data inside a fixed
sentence rather than looking like a second, line-initial notice.

---

## Backends: the one seam, and the loop driver

`packages/spi` holds types only — the capability ports the core depends on. The concrete backends live in the
adapter packages and are injected at runtime by `apps/cli`, which is the single place a backend is constructed.
The runtime-adapter port was shrunk to exactly the calls the session host makes: run the loop, register the
governed catalogue, demote the built-ins coa removes, wire the two hooks, and render the neutral config into
native form. Settled usage flows back through a construction-time settlement callback rather than a method.

Adapters differ in **shape, not interface**:

- **`adapter-claude-sdk` is fat.** The SDK owns its loop; coa configures and governs around it.
- **`adapter-openai-compat` is thin.** It implements one primitive — a single model round-trip over any
  OpenAI-compatible HTTP endpoint — and `packages/loop-driver` supplies the governed loop, so the
  governance-critical dispatch path exists exactly once. On this path coa executes every tool call itself, so
  governance is tighter, not looser: the per-tool predicate is checked inline before execution, the close gate
  runs before the turn may end, and neither ever throws. The driver carries a hard iteration bound as a
  fail-safe against a non-terminating loop, and a defense-in-depth character cap on any single tool result
  entering the resent transcript (per-tool handlers do the primary bounding; the whole history is resent each
  round trip, so an uncapped result would poison every later turn). The verbatim result is retained
  separately — only the resent copy is bounded.

**One package, four providers.** Every per-provider difference that is real on the wire lives in a data-only
**provider spec**: the chat host, the default model, the model-list endpoint when it diverges, the environment
variables for key, price table and effort ladder, the shipped price and effort defaults, whether an unladdered
model still exposes a thinking toggle, how coa's reasoning selection maps to the provider's request fields, and
how to pull neutral token counts out of that provider's usage shape (flat versus nested cache tokens). DeepSeek,
LongCat, OpenAI and OpenRouter ship as spec objects over one code path. Adding another compatible provider is a
new spec and a new row in the factory's map — not a new package and not a new branch. Price and effort tables
are config-overridable per model by environment variable, merged over the shipped defaults, with a
malformed override falling back to the defaults rather than failing.

The **per-provider turn-drive strategy** lives beside that map, so the provider-to-backend and
provider-to-strategy decisions stay one source of truth and the core never sees a provider literal. An unknown
provider throws at construction, which surfaces as an advisory error frame — never a silent wrong-backend run.

### The Claude path: layering, not replacing

coa does not own the whole system prompt on Claude. It layers its own authority on the SDK's native preset,
because restating baseline conduct the model already follows is pure token tax and fights a model that is
already good at it. The invariant that matters: the composition and compile layers are backend-neutral and emit
every piece; the **only** place a backend's coverage is subtracted is the adapter's render step, which drops a
small hand-picked set of generic baseline pieces. Bare-API adapters apply no drop-set and render everything.
The known cost is that the drop-set can drift against the vendor's preset with no automated signal.

Leaning on the preset reopens a config-leak risk, and its containment is unconditional and test-asserted: the
adapter sets an empty setting-source list, strict MCP config, and an explicit empty skills list on every
session, so the target repository's own instructions file, settings, ambient MCP servers, and discovered skills
can never enter a governed session as authority coa never rendered.

**coa borrows the harness; it never modifies it.** The vendor harness is a compiled binary behind a thin
wrapper. Forking the public repository buys none of the behavior anyone would want to change, and patching the
binary fails on release cadence, checksum and signature integrity, and licensing. The ruling is: configure the
harness, or don't borrow it for that case — the pure-API path exists. There is no middle option involving a
modified binary, and the rule is uniform for any future borrowed harness. The mitigation for "the boundary
moves under us" is a kept control-probe suite in the adapter: every measured verdict is version-stamped and
asserted, so an SDK bump fails a probe and names what expired instead of silently invalidating a design.

### Verified SDK behavior the Claude adapter relies on

All verdicts are stamped against the pinned SDK (0.3.196) and its bundled CLI (2.1.196). "Live" means verified
against the real CLI and a real account; the rest are verified at the wire or typings level. Upstream ships
roughly twenty-seven releases a month, so these are tripwires, not trivia.

**Permissions and per-tool governance**

- The auto-approve list means auto-approve, **not** availability: a tool listed there is pre-permitted and never
  reaches the permission callback (live — the model called built-in and MCP tools freely while the callback saw
  nothing, and dropping the list made the same calls reach it). Granting through it silently disables your own
  per-call governance, so the adapter keeps it permanently empty. The three levers split cleanly (live): the
  tool list is what is advertised (an empty list genuinely empties the built-in set), the auto-approve list
  removes nothing, and the disallow list removes a tool from the model's context.
- A permission-callback allow result must echo the tool input back. A bare allow typechecks but the real CLI
  treats it as a permission error for every tool — nothing executes.
- The permission callback is **not** a universal seam. It is never consulted for a native delegation call
  (live: the model emitted the spawn, the callback saw nothing), and under the native preset it was not
  consulted even for a plain in-directory read (measured zero of two with the preset, six of six without;
  mechanism hypothesized, not proven). Per-tool governance therefore rides a single pre-tool hook that only
  denies or abstains and **never asserts allow** — an explicit allow at that seam is just an auto-approve, the
  same mistake the design replaced.
- That hook can deny a call and can rewrite its input before it runs (live), but has no result-bearing field:
  coa can gate or reshape a call, never answer one. Denies are honored for real (live) — denying a built-in
  read stops the read, and denying one of coa's own tools stops the handler from running, which is the fact
  that makes a governed spawn viable.

**Hooks and the turn boundary**

- The pinned SDK exposes thirty hook events. Shipped code registers exactly three: stop (the close gate),
  pre-tool (the gate), and post-tool (the reconciler trigger).
- A blocking stop hook genuinely keeps the loop open (live: the hook is consulted again). But the turn cap
  outranks it — with the cap hit the run ends as a raised error no matter how the hook answers. The close gate
  argues only *inside* the turn cap; the two are not peers.
- The SDK splits one options object across two wire channels: a small fixed argv set, and one stdin control
  request carrying everything else (system prompt, hooks, tool aliases, agents, skills). Hook registration is
  argv-invisible and only the permission callback leaves an argv trace, so any diagnostic reading argv alone is
  blind to half the surface. Turn outcomes carry a thirteen-member terminal-reason union, which the adapter
  reads off the boundary frame.

**Tool surface control**

- Every backend carries the same eight-tool floor — read, glob, grep, write, edit, bash, web search, web fetch
  — set unconditionally: an empty capability frame yields the floor and an allow list narrows it, never widens
  it. Everything outside the floor was ungoverned, unrecorded, and unmatched on other backends.
- coa owns **no native tool implementation**. Trained priors cover the whole contract including output shape —
  the numbered lines a read emits are exactly what an edit's exact-match is calibrated against — so
  substituting a body under a native name reproduces known upstream hazards for no gain.
- The native delegation tool is spelled inconsistently inside one version: the initialization frame advertises
  one name while the model emits another in the same live run. Every list that names it carries both spellings,
  and a drift test forces each of the SDK's generated tool schemas to be classified (grantable or not
  model-visible) on every bump — an omission silently discards a valid grant, which is how one spelling was
  lost once.
- Tool aliasing is honored at dispatch (live: a model-emitted native name ran coa's own handler, and the
  handler's output rather than the file on disk reached the model) — but an alias only **redirects** a name the
  harness already advertises, never publishes one. So per tool the choice is binary: keep the native tool
  advertised and alias it (owning the implementation, inheriting the vendor's name, schema and trained prior),
  or ship under coa's own namespace (owning everything, with no trained prior). There is no third option.
- System prompt: only the preset *object* preserves the harness baseline (the wire then carries no system-prompt
  key); an append field layers coa's text as a sibling; a raw string replaces the prompt outright; omitting the
  option sends an empty custom prompt, **not** the preset. The preset is a dial, not a switch, and the tool
  baseline is a separate preset on a separate channel.
- An empty setting-source list is not full isolation: it governs only the three filesystem settings files. The
  managed/policy tier is still read from disk, project MCP config needs the strict flag separately, skills
  discovery needs an explicit empty list (unset is not "off"), and a per-agent project-memory setting would
  still read target-repo files on a channel the setting-source list never appears on. The adapter sets each of
  these explicitly and states the residual honestly rather than claiming an isolation it does not have.

**Session lifecycle, injection, and persistence**

- There is no silent mid-session system channel. A streamed system-role message is transmitted verbatim but not
  obeyed (live); a non-querying user message *does* land in context and is recalled later, but still costs a
  turn and produces a result frame. Mid-loop delivery therefore rides hook additional-context — the substrate
  the delivery queue is built on.
- Compaction is observable and schedulable, never vetoable. The compaction hooks have no specific output type
  and a generic block was ignored live, but coa gets full observation: both hooks, an in-band boundary frame
  carrying trigger, token counts and surviving messages, a context-usage read, and the post-compaction summary.
  A streamed manual compaction turn fires the pre-hook with the instructions verbatim, so coa can choose the
  moment and shape what survives. Caveats: a hook firing is not proof compaction happened (read the boundary
  frame), and auto-compaction can be toggled per session and mid-session.
- A local on-disk session write is structurally required — the SDK's session store cannot be combined with
  persistence off, and the append hook is a mirror called after the local write succeeds. coa cannot be the only
  writer, but it **sites** the write via the config-directory environment variable and keeps its own log as the
  durable record. Live-verified: a session was fully reconstructed from coa's mirrored log after the CLI's own
  store was deleted, and the CLI even accepted a synthesized transcript entry. Resume plumbing is plain argv,
  and the SDK does not enforce the documented session-id/resume exclusivity, so coa must.
- The config-directory variable is one lever doing two jobs: credentials **and** the session store live in it,
  so redirecting the store also relocates the login (an empty directory reads as "not logged in"). Treat
  config-directory redirection as an auth decision, not a storage one.

**Process and environment**

- The environment option **replaces** the child environment entirely — an ambient variable absent from it does
  not reach the CLI (sentinel-verified against a real spawn), except that Windows re-injects a fixed set of
  system variables regardless. The auth overlay depends on this replacement.
- The base-URL variable genuinely redirects the real CLI's inference traffic (live-verified against a local stub
  server) — the premise for ever fronting the loop with an Anthropic-shaped gateway. Note the CLI retries a
  server error with backoff indefinitely.
- The SDK's own budget option is a real enforced hard stop, but it surfaces as an exception **raised out of**
  message iteration rather than as a result frame — anything rendering it must catch, or a deliberate budget
  stop looks like a crash. The separate token-pacing hint is root-only and advisory, and nothing budget-shaped
  exists per-agent or on the delegation tool's input, so a child cannot be ring-fenced by the vendor's own
  machinery.

The SDK's native subagent plane was measured in full and then archived: nothing shipped uses it, because
subagents are coa's own governed sessions instead. Kept in `archive/` for the record — including that hooks
around a native child cannot block its spawn (only a pre-tool deny of the delegation call can), and that the
*calling model*, not the host, picks a native child's permission mode on each spawn.

---

## Auth and browser profiles

coa stores **pointers, never secrets**. A user-global accounts file maps a label to a login — for the
subscription backend, a config-directory path holding a completed vendor login that coa never opens, parses, or
copies; for API-key providers, a stable mode-0600 key file that is written once and never read back. The active
account is tracked **per provider**, so each backend has its own login and switching one never disturbs
another. A missing file is the pass-through case: every provider ambient, empty list. Account ids are random
rather than derived from an email or label, because a derived id inherits their collisions and dies on a
rename — and per-account side state is keyed by it.

Selection is delivered per session through the backend's own environment-override option, never by mutating the
daemon's process environment, which would pin every concurrent session to one account. The overlay also
**clears** the environment variables that would silently outrank a subscription login — the ambient API key and
token variables — because those force API-key billing and defeat the reason multiple subscription accounts
exist. No accounts registered means no overlay and byte-identical ambient behavior. Recorded spend is attributed
per account label.

**Login health is probe-derived.** Health comes only from the CLI's own status probe, never from reading token
files, which would breach credential-blindness and lie under silent token refresh. The probe's landed email is
the identity truth; a mismatch is surfaced with keep-or-retry. A broken *active* account is flagged with a
re-login action and **never silently rerouted** to another account, because silent switching hides the problem.
Health is cached per daemon run and refreshed on view, refresh, or a live failure — no background polling.

**A login is a transition, not a state.** A flow completes only if the login directory *started clean*: the
manager probes a baseline concurrently with the CLI spawn and finalizes only from that baseline. A directory
that was already authenticated ends in a distinct "pre-existing" decision naming who it holds — use it or
cancel — instead of being reported as a successful login that never happened. That failure was live: closing
the browser tab without authorizing used to "succeed". A baseline that cannot be established is treated as
clean, so probe failure degrades to the old behavior, and the verdict is enforced at the one completion funnel
every probe-driven path passes through rather than per caller. **Removal then deletes the login coa created,
and only that**: the ownership test is a path-containment check under coa's own logins root and it fails toward
*kept*, because a config directory the user pointed at is their data. There is no toggle — a login *is* the
credential, and keeping it is what produced phantom re-login surprises.

**Browser-profile isolation.** Isolated sign-ins launch a *real* browser — embedded windows are rejected by
identity providers, and honesty beat spoofing — with per-identity cookie isolation via one Chrome profile
directory per identity under a **single shared** user-data directory. That split was measured: roughly ninety
percent of a per-identity user-data directory was shared machinery, not the login, so isolation is bought per
profile rather than per directory. Profiles are keyed by **identity, not account row** (a readable slug plus a
short digest of the email), because the jar is a cache of a signed-in identity whose worth is being found
again; row-keying stranded unreachable megabyte-scale orphans and forced re-sign-ins. The cookie jar keeps its
opt-in toggle, because a jar is a cache, not a credential.

The browser environment shim is a **courier**, not a launcher: it writes the CLI's self-completing authorize
URL to a file and exits, suppressing the CLI's own browser open, and coa performs the real open itself as an
argv spawn with **no shell in the path**. Every failure in this lineage was a shell-quoting failure, so the
class was removed rather than patched — a batch file is trusted only to copy a string to disk, never to build a
command line. The shim is necessary because the URL the CLI *prints* and the URL it hands the browser variable
are different: they share a handshake but not a redirect target, so the printed one ends in a code the user
must paste back while the relayed one completes itself against a localhost callback. Every failure degrades to
copy-link plus paste-code, which stays portable to another device. Dead jars are reclaimed only through a
surfaced list the user acts on, renamed before deletion so an open window cannot leave a half-deleted jar —
never by a background sweeper.

---

## Model catalog

The per-provider model list the pickers consume is the **user's editable list**, seeded from a hand-verified
shipped catalog. The backend's live model fetch is demoted to enrichment — capabilities, and an "add from
defaults" affordance — because no backend reliably enumerates what actually works: the SDK advertises a handful
of aliases while a subscription honors explicit older ids it never mentions. Resolution runs user override,
then live fetch, then shipped catalog, then a bare runnable descriptor for an id no tier knows.

Never-cage holds structurally: an emptied list serves empty, a removed or hidden id still runs on the wire, and
an unknown hand-typed id assembles into something runnable — the backend is the real authority and an invalid
id errors live rather than being blocked locally. Reaching a new model is a data change, not a
rearchitecture. A per-account capability cache fronts the fetch and never caches a rejected fetch, so a
key-less provider fails loudly rather than serving a silent empty list.

---

## Agent registry and prompt composition

Two registries, two jobs. A **package/role registry** ships in code as the starter set an agent can be
assembled from; an **agent-definition registry** reads user-authored agents from scope directories — one YAML
file per agent, the filename stem as its ref — merging two built-in definitions, personal definitions under the
user's home, and project definitions committed in the repository, with project definitions winning on a ref
collision. Every failure there is reported rather than swallowed and never silently resolved: an unparseable
file, a file that tries to name its own ref, and a case-folded duplicate each produce a diagnostic while the
rest of the scope still loads.

A role is coa-authored prose plus typed capability references, and roles are **additive and stackable**: none
selected adds nothing (the permissive floor), and several union their prose and capabilities, deduplicated.
Nothing is mandatory — the core package and the orientation layer are on-by-default and recommended, everything
else is opt-in.

The assembled prompt is a fixed **nine-slot skeleton** rendered byte-stably: identity, model, tone, using
tools, changing code, operating under coa, role, project context, environment. Stable, high-authority content
comes first for primacy and cache warmth, with one volatile tail last — because measured evidence says
structure beats prose and instruction density has a real adherence cost.

coa adds **no refusal or safety prose**. It duplicates the model's trained behavior, costs adherence tokens,
and would amount to an undeclared second block: coa does not govern how a person uses their agent.

---

## Console

`apps/desktop` is an Electron app in three parts, and the boundary between them is enforced.

**Main** owns everything privileged: the daemon's lifecycle and connection, per-user persistence of the shell
arrangement and settings, the window frame and zoom, and the two escape hatches the renderer cannot have —
revealing a file in the editor (spawned shell-free, resolved against the project root main derives itself, and
worktree-confined) and opening a validated web URL. Daemon status is a *transport* fact, not an RPC read, so
main tracks it and pushes it on its own channel. Stopping the daemon goes over the pipe rather than by process
id, so it also reaps a daemon this app did not spawn; a spawned child is still tracked and killed as a
fallback. Every failure carries its **reason** alongside the status, because a bare error enum tells the user
only that they are stuck. The reason is chosen from a rolling stderr tail by preferring the *most recent*
failure-shaped line and skipping stack frames — the daemon reports its own routine trouble on stderr too, so
the oldest error-shaped line in the window is usually the least related to why the process just died.

**Preload** exposes one named function per verb, generated from a shared schema registry, plus three one-way
subscriptions (the daemon push stream, daemon status, window maximize state). No raw IPC handle crosses the
bridge. The renderer's content-security policy is applied as a response header and is strict in production —
same-origin scripts only, no inline or eval, and no network connections at all, since every data flow is IPC.
Development relaxes exactly two directives for the bundler's hot-reload preamble and websocket.

**Renderer** is a three-column workbench: a left nav of surfaces, a center canvas, and a collapsible right
column showing the active session's working state. Surfaces are chat, flags, timeline, auth, usage, and agents,
plus a component showcase gated to development builds. Chat's title-bar segment is a session tab strip that
morphs into a session search; the right column shows the root agent row, the session's plan checklist when it
has emitted one, and a quiet "not tracked yet" line for the things that genuinely have no backing data.

The renderer holds **two stores**, deliberately separate:

- **The shell store** owns chrome only: the selected surface, work-versus-search mode, the tab working set and
  its reopen stack, column widths and dock visibility, the daemon status badge, and the dialog set. Modal
  overlays are mutually exclusive by construction — opening one clears the rest through a single shared
  close-all, so a dialog opened any other way is a visible rule violation.
- **The console store** holds one whole `ConsoleState` object — data down, actions up — assembled by a single
  controller and republished as a **full replace**, never a merge. The controller settles every daemon read
  into an explicit loading/ok/error value that never throws, keeps per-session transcript buffers so a
  background session's streamed frames are retained rather than misfiled, and coalesces incoming frames onto
  one animation frame, because applying each token synchronously would re-render the whole conversation per
  token and starve even the elapsed-seconds timer. A periodic refresh compares its results structurally and
  skips the replace entirely when a tick returns exactly what the last one did.

Three structural rules bind the renderer (the visual register, tokens, and authoring rules are
[UI.md](UI.md)'s):

- **The GUI is a client, never a second source of truth.** Every action it offers is a daemon verb; raw mode
  renders the daemon's frames byte-faithfully and is reachable from the command palette.
- **Exactly one component may render a block**, constructed only from a daemon-issued deny frame. The console
  never originates a denial. This is the one-block invariant made structural at a component boundary.
- **The transcript is unwindowed by design.** Every frame is a real DOM node, with content-visibility keeping
  off-screen rows cheap, because full-conversation text selection and native find are incompatible with row
  windowing. The windowed foundation was built, used, and reversed on that evidence.

Package shape follows the same "one thing each" discipline: `console-kit` is the vocabulary,
`console-transcript` is the one big surface built from it, and the dependency runs one way only. The transcript
is deliberately *not* a kit member — admitting a single-consumer renderer of that size would carve a permanent
exception into the kit's discipline. Every kit member carries an enforced intent contract and a showcase
specimen enforced by test, so the catalogue cannot drift from the code. `console-viewmodel` stays pure: it maps
daemon results to render props and imports neither Electron, React, nor the core.

---

## Spend accounting

**The accounting is real; the cap is gone.** Every settled result is charged exactly once, at settlement, to a
daemon-global spend counter, and the same settlement appends an account-attributed record to the audit ledger.
The ledger is defined by a strict **allow-list** (not a deny-list) over the event shape: token counts, cost,
cache hit, an anonymized node id, rule ids, a coarse scope, the account label the session ran under, and the
family-tree root the spend belongs to. A field outside that list is dropped rather than persisted; a value that
looks like an absolute path is dropped outright, because it can carry a real username or directory layout;
prose-bearing fields never enter it at all. An over-length or control-charactered value that is otherwise
allowed is flattened and capped rather than discarded, because an audit trail's one job is to be complete.

The hard-cap and deny path was **archived** this arc. At head it had become dead configuration: no production
caller ever set a ceiling, so the cap state was a constant and the deny branch was wired but could never fire.
The system was carrying the full plumbing of a block — options, budget math, budget forwarding to the backend, a
deny frame, and its renderer copy — for a stop that could not happen, and every reader of that path described a
behavior the shipped product did not have. The alternative was to make the ceiling real; the maintainer ruled
against it, accepting the consequence with eyes open. What was kept is exactly what carried the value:
settlement, the counter, and the ledger.

Three consequences follow, stated plainly:

1. **The close gate is now the system's only block.** "Exactly two blocks" became exactly one.
2. **Subagent fan-out is unbounded.** There is no depth limit, no width limit, and no spend bound. A spawn tree
   of any shape runs until its work ends, the operator stops it, or the provider's own plan limit does. A depth
   check that denied a spawn would itself be a second block, and a depth counter would only stop a chain, not a
   wide fan-out. The vendor's own machinery offers nothing per-agent to ring-fence a child with. A bound on
   fan-out is a **roadmap** item — most likely a real, user-set ceiling over the kept counter — not a shipped
   feature and not a quiet revival of the dead path.
3. **The read surfaces report unbounded.** The cap read verb, the CLI cap command, and the console's governed
   inspect read all still work and all report no ceiling. Exposing real accumulated spend through them is
   future work.

Cost itself is reported by the backend on Claude. On the pure-API path there is no dollar figure on the wire,
so coa computes one from the provider spec's price table — cache-hit input tokens billed at the cache rate when
one is configured, the rest at the input rate. **A model with no configured price entry costs zero**, which is
the deliberate floor: the accounting never guesses. Shipped tables cover only some models, so an unlisted model
records as free until a price is supplied.

Three honest gaps today: the ledger accumulates in memory for the daemon's lifetime and no surface reads it or
writes it to disk; the console's Usage surface renders a **mock** ledger (clearly labelled as such in its own
source) rather than the real one; and the session listing carries no cost, so the console's family-tree spend
roll-up is built and correct but always renders its "not tracked yet" floor. Wiring the recorded ledger to a
read verb and to those surfaces is the next step, not a claim about today. Separately, the web-fetch
summarizer's spend is recorded to the ledger under its own scope but not charged to the session counter — a
deliberate, named deferral.

The live smoke suites still run under a real-money guard, but that guard now rides a raw backend session-option
pass-through — the vendor's own budget stop, a test-harness concern rather than a governance surface.

---

## Dormant substrate

Some machinery is kept deliberately, unfed, for a later governance era. It is not dead code by accident; it is
parked capability with a known revival condition. Where it had no caller at all it now lives under `archive/`,
which is excluded from compilation, linting, formatting, tests, dependency cruising, and the docs index — each
entry there records what it was, why it was parked, and what would revive it.

- **The symbol and graph layer.** The typed graph, the symbol table, the tree-sitter reparse path, the
  convention extractors, and the scope resolver are all present in `packages/core` and `packages/code-intel`
  and all tested. **Nothing in production populates the symbol table.** That is why the grounding producer was
  archived — it could only query a permanently-empty index, so every lookup missed and it returned nothing on
  every call — and why the symbol-reading tools are unregistered. What *is* live from `code-intel` is
  canonicalization, used by the generation-drift producer, and the import extraction the graph builds on. If
  this layer is revived, its first real design decision (what populates the symbol table, and when) has no
  prior ruling to honor: it starts clean.
- **Health scoring.** A code-health signal producer composed cheap, language-agnostic signals — cycle tangle,
  coupling fan-in and fan-out, churn and hotspot from the change log, size — into a worst-of, never-scored
  profile with conservative starting cut-points. It was never constructed or registered by any path. It sits in
  `archive/` with its composition helper, and both revive together once something calls them and the
  calibration pass its cut-points always awaited has happened.
- **The idle queue.** The daemon is resident precisely so idle pre-compute has somewhere to live: a priority
  scheduler with cancellable handles hangs off the kernel, and the flush runs pending jobs highest-priority
  first. No production path registers a job today. Regeneration, index building, context pre-assembly and
  detection sweeps are its intended tenants.
- **Lazy tool loading.** The catalogue is partitioned into an always-loaded kernel set and an on-demand set,
  and the discovery and load verbs over the on-demand half exist. The adapter marks kernel tools always-loaded,
  but the proxy that would let a model discover and pull an on-demand tool mid-session is not wired: today the
  whole catalogue is registered and the partition only expresses intent.
- **Other parked entries** in `archive/` include the decision log and provenance layer, the flag auto-patch
  planner and reminder policy, the bundle importer and version gate, the write-only signal bus, the
  checkpoint-undo plumbing, the spec-conformance pair, the backend port-manifest shape, and the exploratory
  half of the SDK probe suite.

One capability sits between built and shipped: projecting a whole session tree as a single transcript is
implemented and tested, but its only non-test consumer is a live subagent test. Treat it as capability, not as
a surface.

---

## Known debt

Honest and specific, re-derived from the tree on 2026-08-08. Several long-standing items were closed the same
day and are not listed: the session layer's connection-ownership bug, the suite's load-flakes, a duplicated
grammar table, a git probe leaking expected failure onto the console, the daemon manager discarding failure
reasons, a daemon crash wedging the renderer's run state, the reconciler latching observation off in silence
(it still latches, deliberately, but now says so), and the silent fire-and-forget catches on user-initiated
writes — every one of which now routes through a single advisory failure surface. What follows survives.

**The daemon composition root takes a root override, but its own startup path does not honor it.** The core and
the worktree binder get the configured root — yet inside the same startup, the agent registry's *project* scope
and the persistent conversation store are both built against the process working directory instead, and the
home directory is read at several sites there as an un-parameterized constant. A daemon served against another
root therefore reads its project agent definitions from, and writes its conversation store into, whatever
directory the process happened to be launched in. The visible symptom is a checkout that accumulates a `.coa`
directory it never asked for.

**The auth handlers only half-honor their own injection seam.** The handler map is built in the binary that
owns the home directory and hands the auth handlers stores constructed against it — but the handlers then
compute key-file paths and the managed-login-directory check from the home directory directly, at nine separate
sites. Anything wanting to point that subsystem at a different home (a test, a second profile) gets a split
result: the stores follow the injection and the key files do not.

**Interrupt and steer are a hand-rolled flag machine.** A turn's control state is a mutable record on the live
session — an abort controller, an `interrupted` boolean, and a strategy tag — plus two callback slots (a steer
sink and an interrupt closure) that each drive strategy sets when a turn starts and must clear when it ends, on
several distinct exit paths. The held-open strategy additionally re-arms the flag between turns because the
control record outlives a single turn. It works and is well tested, but correctness rests on every path setting
and clearing the right fields in the right order rather than on a structure that makes the wrong order
unrepresentable.

**The console store's re-render blast radius.** `ConsoleState` is published as a whole-object replace, and
eight components subscribe with an identity selector — the workbench frame, the nav, the center column, the
work dock, the palette, the settings dialog, the new-session dialog, and the agents panel. Every publish
re-renders all of them. Streaming mitigations exist and are real (frames coalesce onto one animation
frame, poll ticks that changed nothing skip the publish entirely, and per-frame projections are cached by
object identity so the transcript's memoized rows actually hit), but the underlying shape is still "one object,
one subscription granularity".

**The transcript exists in three renderer-side copies.** The controller keeps per-session wire frames in one
map and mirrors the active session's into the published state; the chat panel keeps a second map of *projected*
frames per keep-alive tab so a hidden tab keeps showing what it last showed; and two identity-keyed caches hold
the per-frame projections. Each has its own invalidation rule. Nothing is known to be wrong, but a conversation
that goes stale in one of them and not the others would be hard to spot.

**A tab-switch can lose freshly-streamed frames.** Opening a session flips the active id synchronously and
reconciles a persisted reload in the background. The reload's result is guarded against a stale *render* (it
returns early if the user moved on), but it writes into the per-session buffer **unconditionally** — so a
reload that lands after live frames have already been merged for that session overwrites them with the
persisted view. Rapidly switching away and back, or switching away from a still-streaming session, is the
shape that hits it.

**The two-second poll.** Cap state, the flag feed and the timeline are refreshed by a fixed interval rather
than pushed. The structural-equality guard keeps a quiet tick from costing a re-render, but it does not stop
the three round trips, and it means a change lands up to two seconds late. Push notifications for these reads
are the intended replacement.

**Three desktop panel suites have been seen failing intermittently under parallel load and are not
root-caused.** They pass in isolation and the full suite was green when this was written (2,928 passing). This
is recorded as an open question, **not** as permission to wave a red test through: a failure of exactly this
shape was chased on 2026-08-08 and turned out to be a real defect, not a flake. Green every run remains the
rule; an intermittent failure is a bug until proven otherwise.

**The endpoint has no peer authentication.** The daemon binds with default socket and named-pipe security.
Unix peer-credential rejection and a Windows custom DACL are unreachable through Node's networking layer and
need a native addon. Acceptable for an attended single-user local product; it must close before any multi-user
or remote-daemon mode, because that endpoint is the approval and secret-read gate.

---

_Last reviewed: 2026-08-08_
