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
- **coa decides exactly one refusal.** The close gate — a governed "you're not done yet" at turn end — is
  the only thing coa itself decides to stop the agent with. A session's permission mode can refuse a tool
  call too, but that refusal is the operator's own standing choice, and it is **layered onto** the single
  per-tool predicate the deny rules already run through, never a second parallel channel: coa enforces the
  decision, it does not make it. Both predicates are assembled by the session layer and merely run by the
  backend, which holds no policy of its own. Nothing else in the system refuses anything.
- **The core never names a backend.** It asks capability questions with defined null-fallbacks; it never
  branches on which backend is running.
- **No model call on a critical path.** Every governance decision — the gate, the per-tool check, path
  confinement, generation drift — is synchronous and deterministic.
- **External data is parsed at the edges.** `shared` owns the Zod schemas; wire, config file, and IPC
  boundaries validate before anything downstream sees a value.

---

## Daemon and sessions

`coa serve` stands up the daemon. `apps/cli` is its composition root: it resolves the governed project root
and the user's home directory exactly once and builds everything below from those two values — the
project-scope agent definitions, the conversation store, the message log, the library's project store, the
auth handlers' key files, and the endpoint path itself — so a daemon served against another root reads and
writes only there. It then constructs the daemon singletons in dependency order (the change kernel, then the
flag pipeline, then governance, with the prompt compiler and the governed tool catalogue bound by reference),
builds the concrete backend factory and the inspector/auth handler map, and binds a JSON-RPC endpoint.

**The endpoint is keyed by project, not by application.** Its name is a hash of the canonicalized root
(case-folded on Windows), so a client launched inside a project resolves the same address a daemon served from
that project would have bound — no registry file, no discovery protocol, and "is this project already open"
answered by probing the one endpoint its root hashes to. One daemon per project follows from that, which is
what keeps two processes from holding one project's append-only logs open at once. Windows gets a named pipe,
Unix a domain socket under the runtime directory, both framed as NDJSON over any duplex so the protocol layer
stays independent of the endpoint kind. Endpoint hardening (Unix peer-credential rejection, a Windows DACL) is
**not** applied; the seam is marked in the transport, and closing it is a precondition for any multi-user or
remote-daemon mode.

**The daemon owns a live session; a connection is only a viewer.** A conversation's liveness belongs to the
daemon's live-session registry, never to whoever started it. One session service, the single owner of
live-session lifetime, treats `send` as send-or-create: it resolves or mints the conversation id, queues the
request as a turn, and — only the first time — starts a daemon-owned loop that drains that queue one turn at a
time. Every later send, from any client over any transport, rides the same loop. Nothing caller-scoped is
stored on the service; a turn's own facts (the role it asked for, the sink it wants hydrated, the answer it is
waiting on) travel *with* the queued turn, because state kept privately by the founding caller would be
invisible the moment a second client sent the next turn. A live session runs headless with zero subscribers,
and a reattaching client is hydrated with the daemon's true current run status rather than reconstructing
liveness from stale client memory.

Two **drive strategies** sit behind one contract, chosen per provider by the composition root: **held-open**
(Claude) keeps one backend query alive across a session's turns, fed successive user turns as a stream — warm
continuation, no resume replay, with a mid-conversation model or prompt-config change re-establishing the query
rather than silently continuing on the old pinned prompt; **per-turn** (every pure-API provider) runs a fresh
governed loop per turn. Both record through **one frame recorder**, the single place a turn's frames become
visible: it pushes to subscribers and appends to the durable log, so the rules that must hold for both
strategies exist once — streaming deltas are pushed but never persisted, a delivery's log line is written where
the model actually received it, a settled reasoning block carries its wall-clock. A shared per-turn prelude does
the rest: mint the conversation if new, decide how the model regains its memory, reuse or recompile the frozen
prompt, pin the effective model selection, append the user's prompt.

**A turn has one owned lifecycle, held as data.** Where a turn stands — running, stop-requested, stopped, or
settled — is a single named state whose legal edges are enumerated in one table that both drive strategies and
the session service read. An event with no edge from the current state leaves the state untouched and reports
that it did nothing, so an illegal move is not something a caller can express: un-stopping a stopped turn or
reviving a settled run would each need a new row in that table, in the open, rather than a flag flipped in
another file. This replaced two booleans three modules kept in agreement by hand; neither was ever wrong alone,
and the hazard was the combinations nobody had named, which is the shape this layer's last real defect arrived
in. Nothing in the machine throws, denies, or blocks — a user stop is a user action, not a governance decision,
so the machine reports what it did and the caller decides what that means. The session's published run status
stays separate: that is a fact fanned out to subscribers, not the turn's internal state.

**One append-only conversation log per session.** A conversation persists as a single growing `events.ndjson`
under a gitignored per-session directory; the UI view and the provider-shaped transcript are both **read-time
projections** of it. The earlier two-store shape (an incremental UI file plus a canonical transcript rewritten
on clean settle) made integrity a per-call-site flushing discipline and produced disk/conversation divergence on
a mid-turn error; with one log that only grows, integrity is structural — a crash cannot persist an inconsistent
state. Unpaired tool calls are repaired at read time (a synthesized interrupted-execution result; orphaned
results dropped) so cross-provider replay stays valid. Reads never throw: a corrupt session index drops that
session from the listing and a garbage log line is skipped, and what was dropped is **counted and reported**,
because a conversation that lost part of its record must not come back looking whole, either to the console or
to the model being handed its own memory.

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
turn, never lost, never a hang. Sealing the queue is a one-way cancel guard, so a delivery arriving after
teardown can never wake a subtree a person deliberately stopped, and the `system` origin is unforgeable **by
reachability, not convention** — no tool handler ever receives a session handle capable of authoring one.

**A steer is recorded when the model receives it,** at *drain* rather than at send: held while any tool call is
open and written the instant the last one closes. A send-time record claimed a transcript position that never
happened and could land inside a tool-call/tool-result pair, an illegal shape that corrupted cross-provider
replay; phrasing the rule as the legality constraint keeps it correct regardless of unmeasured hook-timing
facts. One writer, in the core, for every backend; an unbalanced turn flushes held lines at the boundary, and a
sealed queue is never drained, so an undelivered steer is never recorded. Barge-in was removed outright: a steer
always delivers at the next possible boundary and never discards in-flight work — discarding a turn is an
explicit stop-then-send.

**Prompt freezing and memory.** Provider caching is a prefix match, so any byte change in the prefix invalidates
everything after it. A session compiles its system prompt once, at the first turn, and every later turn reuses
that frozen compilation verbatim — the neutral config plus the capability frame it was built with, since tools
are part of the cached prefix too. Recompiling is a deliberate, user-raised act surfaced as a drift notice, not
a per-turn side effect. How the model regains memory is decided per turn against the same canonical fold of the
log: a same-provider Claude continuation resumes the backend's own server session by id (the strongest cache
guarantee, eligible only while the live provider and model still match the stamp the token was captured under);
a pure-API backend replays the neutral transcript as history messages; a cross-provider switch *into* Claude
delivers the transcript as a first-turn preamble, since the SDK cannot ingest a foreign transcript into its own
store — after that turn Claude owns a resumable session again.

**Subagents are ordinary sessions with a parent link.** A spawned child is created through the exact same path
as any session, carrying two optional fields — `parent` and `root` — and nothing else distinguishes it, so idle
eviction, the single teardown path, cost settlement and the append-only log are all free with no new state to
synchronize, and an ordinary session's on-disk shape is unchanged because absent lineage writes no keys. Lineage
is a single stored pointer; the descendant walk rebuilds the tree on demand with an explicit visited set, so the
stop cascade provably terminates on any graph shape — the depth cap was dropped deliberately, so a parent chain
can point anywhere, including back up its own ancestry. Abort is wired at the session-lifecycle seam (seal the
queue, close the session), not the turn seam, so it works mid-turn, between turns, or before the first turn, on
every backend. A spawn against a dead parent orphans the child rather than refusing it — a refusal would need a
throw or a lying success — and the orphan runs its turn and self-cleans via idle eviction. By default a
child writes in its root's working tree — the accepted risk that two agents can write the same tree
concurrently, mitigated only by the product being attended and every write still passing the gate. A spawn can
ask for its own checkout instead; that is the worktree section below.

**A completion notice is a fact, not a message.** When a child ends, its parent receives a daemon-authored
lifecycle fact — child id, agent ref, one of three *observed* reasons (completed, errored, stopped), and a
bounded, sanitized error detail. There is deliberately no inferred reason such as "went quiet": a signal that
cannot be detected must not be reported as one. The notice rides the same delivery queue as everything else.

A cleanly completed child's notice **also quotes what the child actually said** — a bounded excerpt of its final
answer, produced by folding the child's own append-only log after it has already ended, capped at two thousand
characters and flattened exactly the way an error detail already was, with a truncation note naming the child's
transcript as where to read the rest. The earlier rule was that a notice never carried the child's text at all,
because a child-authored report would let a broken or adversarial child's claim of "done" pass as an observed
fact. The distinction that survives is **who composes the sentence, not whether the sentence quotes the child**:
the daemon still writes every word, the excerpt is read by the daemon off the same log the parent was
previously told to walk itself, and nothing the child asserts through a tool argument can reach it. The system
origin stays unforgeable by reachability, unchanged. What remains is a fidelity limit, not a forgeability one —
a child that hallucinated its own success still reports that hallucination, exactly as it would if the parent
read the transcript itself — and the full-fidelity path is never removed: anything past the cap is still
reachable by reading the child's log directly. Leaving the gap open had cost more than expected, since a parent
with several children re-derived per caller a read the daemon had already done once.

Teardown has exactly one path. Idle eviction, the explicit close verb, and daemon shutdown all route through the
same registry close, which is where the spine checkpoint and the worktree release happen — once, never twice —
and idle eviction is running-aware and never fires on a live turn.

### Agent-to-agent messaging

**Agents in one family tree can message each other.** Membership is a **mesh**, not a hierarchy: any member may
address any other, and the parent link is provenance, never a routing or permission boundary. Sender and target
must share a root; a target in another tree, or one wholly unknown, comes back as an ordinary unapplied tool
result rather than a denial, mirroring how an unknown spawn reference already replies — adding a block at a
messaging seam would have been a second governance surface. The sender's identity is stamped by the daemon from
the calling session, never read from a tool argument, and the literal sender name `system` is reserved for a
future daemon-authored broadcast that nothing produces yet, because reserving it now is cheap and retrofitting
it into a shipped log format would not be. A message body is untrusted agent-authored free text and gets exactly
the treatment a completion notice's excerpt gets: flattened, capped, quoted inside a daemon-composed envelope.

Delivery reuses the two mechanisms the session layer already had, chosen by the recipient's current state. A
recipient **mid-turn** receives the message through the existing delivery queue, tagged system-origin and
persisted as a system-role line so it stays distinguishable from the human's own words. Every other state —
parked between turns, evicted from the live registry, or never started — collapses onto **one** mechanism:
enqueue a fresh turn, reviving the session from the store's permanent lineage when the live registry has no
record of it, and deriving its role and model from the recipient's own agent definition exactly the way a
spawn's founding turn does. None of those three can be reached by pushing onto a queue nothing is draining,
which is the whole reason four notional delivery states collapse to two real ones. On that waking path the
peer's message carries a bracketed provenance marker rather than a widened schema — a fresh turn's input has no
role slot for "a peer agent said this" — which is honestly a text convention rather than a type-level
guarantee, chosen because widening the provenance enum would ripple through every adapter's delivery rendering
and the console's role labels for a distinction only one path needs. A real schema widening is named, deferred
work.

The roster an agent reads is **relationship-relative**: every tree member labelled self, parent, child,
ancestor, descendant or other relative to the caller, with both the descendant and ancestor walks cycle-guarded
by explicit visited sets so a hand-edited or adversarial lineage cannot loop them. Each row carries a liveness
reading with **graded confidence** — observed for a session currently registered or one whose end this process
itself watched, advisory for one that is neither — because a signal this process did not observe must not be
reported as though it were. Sending is deliberately not hard-blocked on liveness: coa has no permanently dead
session, since any torn-down conversation is resumable by sending to its id again, so refusing to wake a message
target would invent a restriction the rest of the product does not have. Rows ride back to the model as one
escaped object per line, so a hostile agent name can change how a row displays but can never plant a decoy
identifier on the same line. Messages persist to their own append-only log, one file per family-tree root under
the same gitignored local directory as the conversation store, and deliberately **not** the change-event spine —
conversational traffic between agents is not a fact about what changed in the codebase. A fresh message anchors
its own thread; a reply resolves the thread it joins from that log, falling back to naming itself rather than
throwing over a stale reference.

### Worktrees

**A session's worktree is the shared repository root unless its founding turn asked for isolation**, in which
case it gets a real separate checkout under a gitignored directory named for the session. Isolation is opt-in
per spawn rather than the default, because most children only read and would otherwise pay a real checkout's
time and disk for nothing. It degrades honestly: a project that is not a repository, or a checkout that fails
to create for any reason, falls back to the shared root rather than failing the session — the same shape the
change reconciler already uses when it finds no repository — and the shared-root path is byte-for-byte what it
was before isolation existed, so the common case carries none of the new machinery's risk.

The bind is **idempotent per session** for the process's lifetime: a session already bound returns its
previously decided path and ignores what the later call asked for. This is load-bearing rather than tidy, because
one drive strategy rebinds on every single turn while the other binds once, and only a spawn's founding turn
ever carries the isolation flag — an ordinary later send against the same child carries none. Without
idempotency the second turn would try to create a checkout at a path that already exists, and a later flagless
turn would silently downgrade an already-isolated session back to the shared tree. There is **no durable index**
of worktrees: the repository's own worktree registry plus each directory's modification time are treated as the
complete truth, so a fresh process reconstructs what exists from disk alone and a crash loses nothing worth
losing. A session this process never bound is reconciled against that registry before any decision is made,
which is what carries an isolated session — and whatever uncommitted work sits in its checkout — correctly
across a daemon restart.

**Nothing removes an isolated checkout implicitly.** Cleanup has exactly two paths, both deliberate: an explicit
reap, or a sweep at daemon start over whatever the fresh process has no record of, reaping only those past a
configured idle window (a day by default) judged by the directory's own modification time. Closing a session
deliberately does *not* delete its checkout — the moment right after a subagent finishes is exactly when someone
is most likely to want to look at what it produced, and the session-close hook fires on idle eviction and
shutdown alike, so wiring deletion to it would delete on every one of those paths rather than only a deliberate
cleanup. The console surfaces isolated worktrees over a read verb carrying path, creation time, whether the
session is running, and a cheap dirty and changed-file count; a row whose status read fails still lists, just
without those fields. The reap verb refuses a session with a turn in flight, judged from the daemon's own live
registry — a safety interlock on a person's own cleanup control, not a third thing that can refuse an agent,
since the agent is never the caller.

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
git probe throws outside a worktree, and coa must work on any project: that expected failure is silent (stderr
captured, not inherited) and degrades observation to a no-op, running exactly as it would with no git at all.

A failure *once observation is running* is treated differently. A few consecutive scan failures are tolerated
and retried, because the usual causes — an index lock held by another command, a file disappearing mid-scan —
clear on their own. Past that tolerance observation latches off, since re-running a scan that keeps failing
spawns a git process per tool call for nothing — and the latch **announces itself** as an advisory notice on the
flag feed, because the symptom is otherwise invisible: edits made outside coa's own tools simply stop being
recorded.

---

## Flags and the close gate

One pluggable pipeline, one shared flag schema, no per-producer side channels. Registration is the only
add-path, gated by a validation stamp that rejects an unvalidated producer rather than admitting it; ingestion
is the only emit-path. On read the pipeline deduplicates by concern, assigns two independent axes (severity and
confidence), and fans out to two audiences: the person sees everything, with low-severity concerns
collapsed-but-counted rather than hidden, while the agent gets a gated, grouped injection of only
high-confidence, high-severity items, with the rest riding a count line. A typed-reason triage channel records
*why* a flag was acted on or dismissed and applies the deterministic effect (a wrong guess resolves it, a
won't-fix baselines it); prose-bearing notes stay local to the spine and never enter the audit ledger.

Producers are driven off the kernel feed: the pipeline owns a projection, subscribing from cursor zero and
replaying history before going live. A **reconciling** producer — one that emits its complete current set — is
driven differently: the driver tracks the fingerprints that producer last emitted and resolves any it no longer
emits (the self-heal), and runs one convergence sweep at wiring so state already dangling at startup surfaces
even with no change events. Per-producer tracking keeps the diff scoped. With no producers configured the
pipeline is inert: the gate allows and nothing fires.

**The close gate is the only block in the system.** It fires at turn end when unresolved high-severity,
may-block concerns exist, and it does not stop the agent — it keeps the loop open and feeds its reason back so
the agent keeps working. It is issued through a single seam alongside the per-tool check, so auditing "can coa
ever stop me" is a one-line answer instead of a system-wide search. The per-tool advisory-to-deny rules ride
the same seam but are explicitly demotable pipeline policy, not a second standing block: the predicate is
first-deny-wins and **fails closed** on a throw, refusing rather than admitting an unchecked call. Backends
hold no policy — they only run the predicate the core assembles. Today no production path registers a per-tool
deny rule, so that channel is wired end to end and never fires; the deny machinery exists for the rules a later
governance pass would add.

### Permission modes

Every session carries one of four **permission modes**: read-only (writes and commands are refused outright),
ask before a write or a command, auto-approve edits but ask before commands, and ask nothing. The mode is
decided per session, defaults to asking before a write or a command, can be overridden per agent definition,
and can be switched live — taking effect on the next tool call, never retroactively on one already in flight,
because the mode is read fresh on every call rather than baked into the session.

Enforcement is deterministic and lives in exactly one place: the same per-tool predicate the deny rules ride.
The mode **layers on top of** those rules rather than sitting beside them — the deny rules run first and
unconditionally, and the mode can only further restrict what they already let through — which is what keeps
"what in this system can refuse a call" a single predicate rather than a system-wide search. A tool's risk class
is read off the same manifest tags the catalogue already declares for capability allow-listing, one taxonomy
rather than a second: network tools fold into the read class, since they touch neither the working tree nor a
subprocess, and a tool coa's own catalogues do not name — a backend built-in with no manifest entry, or any
external server's tool — classifies as a **command**, the most cautious bucket. That fail-closed default is
deliberate: defaulting an uncatalogued tool to read would make every externally-supplied tool invisible to the
mode meant to govern it.

An **ask** blocks the tool call on a promise the daemon holds open, pushes a live approval card to subscribers,
and reflects a distinct blocked status without changing the session's underlying running state — a blocked call
is not a stopped turn, the turn is still running underneath. Answering resolves it, and the running status
resumes only once every outstanding ask has cleared. A session torn down, or stopped by the operator mid-ask,
resolves every pending ask as denied rather than leaving a promise nothing would ever settle, which would wedge
the daemon's pending map and gate-lock the composer for a call that will never happen; a second answer to the
same request is a harmless no-op.

**Whether a mode can be enforced at all is a per-backend fact**, resolved once the provider is known, and a
backend with no genuine approval seam collapses every mode to ask-nothing rather than claiming an enforcement it
cannot deliver. Both wired backends honor it — the pure-API governed loop checks the predicate inline before
executing a call, and the vendor SDK's pre-tool hook is live-verified — so the seam reports true for every
provider the factory knows and exists for a future backend to declare honestly. When the effective mode differs
from the configured one, the session pushes the degrade with its reason attached.

The refusals are real, and worth naming plainly against the one-block invariant: read-only mode refuses a write
or a command outright with a reason, and a person's denial of an ask returns a deny to the model. Neither is a
governance block in the close gate's sense — both are the **operator's** own standing choice, exercised through
the same seam rather than a second one — but the surface they bind is wider than the close gate's, covering
every catalogued tool plus every external server's tools. Two consequences are honest gaps rather than design:
a mode refusal produces no governed-stop frame, because the frame vocabulary carries exactly one kind of stop,
so in read-only mode a refusal reaches the person only through whatever the model then says about it; and the
end-to-end link — a real model's call reaching the ask and a person's answer returning over a live backend — is
proven at the daemon level with regression tests but deliberately unmeasured live.

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
whole-file patch escape, the subagent spawn, and the inter-agent send — the send is kernel because an agent that
can spawn must be able to reach what it spawned without a discovery round trip first) and an on-demand set
discovered and pulled in when needed, which now also carries agent discovery and the live family-tree roster.
The symbol-reading verbs are implemented but deliberately **unregistered** — the index they read has no
producer feeding it, so they could only return empty results; they rejoin the catalogue when that layer is fed.

**Two orthogonal axes decide whether a model can call a tool:** which partition it sits in (whether its schema
costs standing context or is fetched on demand) and which starter package grants it. They are independent —
some editing tools sit in the always-loaded partition yet are deliberately opt-in through a coding package, so
a role without that package stays edit-less. The distinction was learned expensively: a tool was registered
in-process and looked correct in every test, but no package listed it, so it was invisible to every model until
a live run failed. A regression guard now asserts every catalogued tool is granted by at least one starter
package, so a tool cannot ship registered-but-unreachable again.

One dispatch boundary turns pure handlers into registered tools, where two cross-cutting rules land: inputs are
schema-validated before a handler touches shared state, and every return is decorated with the gated,
agent-audience flags. Dispatch **never throws and never denies** — a malformed input, a confinement rejection,
or a failed diff comes back as a typed unapplied result the agent can read and retry. Each tool also carries its
own display renderer and success predicate, since a pure-API loop has no backend-supplied result text or error
signal.

**Path confinement** is the load-bearing precondition: coa's in-process tools are not covered by any backend
sandbox (deny rules bind built-in and shell tools, not custom in-process ones), so every handler runs a
deterministic check before touching disk — resolve symlinks, reject anything that escapes the session worktree
(a parent traversal, an absolute path, a symlink pointing out), then reject anything matching the forbidden set
(coa's own local directory plus any injected deny globs). The math runs in POSIX path space, since the spine
addresses files with forward-slash worktree-relative paths; a Windows drive-letter root is mapped into that
space for the traversal and rebuilt afterward so it stays openable.

The tree it confines to is the **session's own bound worktree**, not the project root: the catalogue is built
per session against whatever that session bound, so an isolated session's edit, patch and base file and shell
tools all operate against its own checkout. Only the vendor's native tools inherited the right working directory
before; isolation that covered half the tool surface would be worse than none, since the agent would read one
tree and write another. The daemon's resident symbol and graph index stays project-wide regardless, so an
isolated session's reads through it can drift once its own edits diverge from the shared tree — an accepted
floor, named so a later reader does not treat a stale symbol read as a bug of unknown origin.

**Two independent gates must never collapse into one:** "does this backend have an executor behind this tool
name at all" is a composition-time fact, and "may this session call it" is the capability frame plus the
permission predicate — different questions.

### The pure-API tool floor

Thin backends are bare chat APIs — no executor exists behind a tool name unless coa supplies one — so on that
path coa owns the file tools (read, glob, grep, write, edit, bash) and the web tools, while the Claude path
keeps the vendor's better-integrated equivalents. The shell is resolved once per session, so a model's POSIX
one-liners get a POSIX shell on Windows where one is present. Named deviations, accepted for an attended
single-user product: the shell tool is confined to the worktree, output-capped and time-boxed, but has no OS
sandbox (parity with the vendor's own shell), and web domain filters are forwarded to providers rather than
enforced locally. Writes fund through the one spine emit path, so a thin-backend write is exactly as observable
as any other.

**Web egress** is credential-gated and cooldown-aware: search and fetch each run a chain of providers degrading
to a plain-fetch floor, with a shared classifier separating a rate limit from a real failure and a key-state
store holding cooldowns. Provider keys live as credential-blind pointers in a user-global config plus mode-0600
key files, the same pattern as account auth, assembled in `apps/cli` and injected as finished dependencies so
the core stays backend-blind. No configured keys means the two tools are simply not offered; deps without a
summarizer still offer fetch on its raw-markdown floor — degradation, never an error.

**Subagent dispatch** is an ordinary tool. It resolves an agent ref against the live registry — read per
dispatch, never a list cached at session start, so an agent authored moments ago is spawnable immediately —
starts the child and returns its id **immediately**, without waiting for its work, holding no governance surface
of its own beyond the same per-tool seam every other call passes. Everything it echoes back to the model (a
model-chosen ref, an agent's name or description from a hand-authored file) is flattened through one shared
sanitizer and length-capped, so a hostile or merely huge string stays inert data inside a fixed sentence.

A model can also **discover** what it may spawn rather than learning the roster reactively off a failed spawn's
error reply: an on-demand search runs over the same live registry the spawn resolves against, by ref, name or
description, with the query optional so omitting it lists everything. It reuses the same roster read and the
same bounded sanitized encoding, so it is a query surface over the existing registry rather than a second one.
Matching runs against the raw fields and only the echoed output is sanitized — separating what is matched from
what is displayed is what keeps display sanitization from quietly becoming a search filter.

---

## Backends: the one seam, and the loop driver

`packages/spi` holds types only — the capability ports the core depends on. The concrete backends live in the
adapter packages and are injected at runtime by `apps/cli`, which is the single place a backend is constructed.
The runtime-adapter port was shrunk to exactly the calls the session host makes: run the loop, register the
governed catalogue, demote the built-ins coa removes, wire the two hooks, and render the neutral config into
native form. Settled usage flows back through a construction-time settlement callback rather than a method.

Adapters differ in **shape, not interface**. `adapter-claude-sdk` is **fat**: the SDK owns its loop, and coa
configures and governs around it. `adapter-openai-compat` is **thin**: it implements one primitive — a single
model round-trip over any OpenAI-compatible HTTP endpoint — and `packages/loop-driver` supplies the governed
loop, so the governance-critical dispatch path exists exactly once. On this path coa executes every tool call
itself, so governance is tighter, not looser: the per-tool predicate is checked inline before execution, the
close gate runs before the turn may end, and neither ever throws. The driver carries a hard iteration bound as a
fail-safe against a non-terminating loop, and a defense-in-depth character cap on any single tool result
entering the resent transcript, since the whole history is resent each round trip and an uncapped result would
poison every later turn — the verbatim result is retained separately, only the resent copy is bounded.

**One package, four providers.** Every per-provider difference that is real on the wire lives in a data-only
**provider spec**: the chat host, the default model, the model-list endpoint when it diverges, the environment
variables for key, price table and effort ladder, the shipped price and effort defaults, how coa's reasoning
selection maps to the provider's request fields, and how to pull neutral token counts out of that provider's
usage shape. DeepSeek, LongCat, OpenAI and OpenRouter ship as spec objects over one code path; adding another
compatible provider is a new spec and a row in the factory's map, not a new package or branch. Price and effort
tables are config-overridable per model by environment variable, merged over the shipped defaults, with a
malformed override falling back to the defaults rather than failing. The **per-provider turn-drive strategy**
lives beside that map, so the provider-to-backend and provider-to-strategy decisions stay one source of truth
and the core never sees a provider literal; an unknown provider throws at construction, surfacing as an
advisory error frame rather than a silent wrong-backend run.

**Attachments ride the existing neutral message shape.** An image (mime type plus base64 bytes) or a text file
extends the neutral chat-transcript record every adapter already consumes, as one optional field rather than a
parallel carrier — so every consumer of that record round-trips them for free, and a live turn's first message
threads them through the governed loop the same way history replay already did. A second carrier beside the
record would have been exactly the drift the shared-schema convention exists to prevent. Text is inlined
unconditionally; the vision check lives at the adapter's own wire-mapping seam, gated by a plain boolean the
caller injects from the metadata catalog rather than a capability table inside the provider spec or a catalog
lookup performed adapter-side — the core may not import an adapter package, so the answer crosses the seam as a
finished value.

Capability is **refused, never silently dropped**, and the refusal is layered. A model with no verified vision
support is a typed rejection at the wire seam for the live turn's own attachment. The vendor SDK path has no
attachment seam at all — its live-turn prompt is a plain string — so it reports honestly that it carries none,
and the daemon's own request edge rejects an attachment-carrying send to it, defended again inside the adapter.
But an unsupported image sitting in **resent history**, attached in an earlier turn under a possibly different
model, degrades to a neutral text note instead: a boundary marks where the live turn begins, so a model switch
never breaks every later plain-text turn over an attachment the person is not even touching. Refusing the live
one is right because the person just chose it; refusing the historical one would break unrelated turns.

**One boundary owns the fresh-versus-cached token split.** Every OpenAI-compatible wire reports prompt tokens as
fresh and cached combined, while the vendor SDK reports them separately, so the compatible adapter subtracts the
cache hit out once, at the single point every provider spec funnels through. The neutral usage record therefore
means *fresh input* on every backend, and every downstream consumer — the spend ledger, the console's context
gauge — can add fresh input and cache reads to get a true total without re-deriving the rule. Before this, the
same neutral field meant two different things depending on backend and the pure-API ledger double-counted
cache-hit tokens into its input count; fixing it per provider spec would only have guaranteed the next spec got
it wrong again.

### The Claude path: layering, not replacing

coa does not own the whole system prompt on Claude — it layers its own authority on the SDK's native preset,
because restating baseline conduct the model already follows is pure token tax and fights a model that is
already good at it. The composition and compile layers are backend-neutral and emit every piece; the **only**
place a backend's coverage is subtracted is the adapter's render step, which drops a small hand-picked set of
generic baseline pieces (bare-API adapters apply no drop-set and render everything). The known cost is that the
drop-set can drift against the vendor's preset with no automated signal.

Leaning on the preset reopens a config-leak risk, and its containment is unconditional and test-asserted: the
adapter sets an empty setting-source list, strict MCP config, and an explicit empty skills list on every
session, so the target repository's own instructions file, settings, ambient MCP servers, and discovered skills
can never enter a governed session as authority coa never rendered.

External tool servers the person deliberately added through the library are the one thing that does enter, and
they enter through **exactly one channel**: the library-resolved server map maps onto the SDK's own server
option, beside coa's in-process governed server and spread so that **coa wins a name collision** — a library
entry named the same as the governance surface must never shadow it. The strict configuration flag stays on
throughout, so a project's own ambient server config still cannot ride in alongside, and unmodeled configuration
keys the store round-trips are deliberately not forwarded: only fields verified against the installed SDK types
are handed over. coa manages configuration and surfacing; the SDK owns the server runtime, which is composition
rather than reimplementation. A pure-API backend has no such runtime and says so, emitting a typed error frame
naming the servers it cannot provide before the loop runs rather than proceeding silently without them.

**coa borrows the harness; it never modifies it.** The vendor harness is a compiled binary behind a thin
wrapper — forking the public repository buys none of the behavior anyone would want to change, and patching the
binary fails on release cadence, checksum and signature integrity, and licensing. The ruling is: configure the
harness, or don't borrow it for that case (the pure-API path exists) — no middle option involving a modified
binary, uniform for any future borrowed harness. The mitigation for "the boundary moves under us" is a kept
control-probe suite in the adapter: every measured verdict is version-stamped and asserted, so an SDK bump fails
a probe and names what expired instead of silently invalidating a design.

### Verified SDK behavior the Claude adapter relies on

All verdicts are stamped against the pinned SDK (0.3.196) and its bundled CLI (2.1.196). "Live" means verified
against the real CLI and a real account; the rest are verified at the wire or typings level. Upstream ships
roughly twenty-seven releases a month, so these are tripwires, not trivia.

**Permissions and per-tool governance**

- The auto-approve list means auto-approve, **not** availability: a listed tool is pre-permitted and never
  reaches the permission callback (live — the model called built-in and MCP tools freely while the callback saw
  nothing; dropping the list made the same calls reach it). Granting through it silently disables per-call
  governance, so the adapter keeps it permanently empty. The three levers split cleanly: the tool list is what
  is advertised (empty genuinely empties the built-in set), the auto-approve list removes nothing, and the
  disallow list removes a tool from the model's context.
- A permission-callback allow result must echo the tool input back — a bare allow typechecks but the real CLI
  treats it as a permission error for every tool, and nothing executes.
- The permission callback is **not** a universal seam: it is never consulted for a native delegation call (live)
  and, under the native preset, was not consulted even for a plain in-directory read (measured zero of two with
  the preset, six of six without). Per-tool governance therefore rides a single pre-tool hook that only denies
  or abstains and **never asserts allow** — an explicit allow there is just an auto-approve, the same mistake
  the design replaced.
- That hook can deny a call and rewrite its input before it runs (live), but has no result-bearing field: coa
  can gate or reshape a call, never answer one. Denies are honored for real — denying a built-in read stops the
  read, and denying one of coa's own tools stops the handler from running, the fact that makes a governed spawn
  viable.

**Hooks and the turn boundary**

- The pinned SDK exposes thirty hook events; shipped code registers exactly three — stop (the close gate),
  pre-tool (the gate), and post-tool (the reconciler trigger).
- A blocking stop hook genuinely keeps the loop open (live), but the turn cap outranks it: with the cap hit the
  run ends as a raised error no matter how the hook answers. The close gate argues only *inside* the turn cap.
- The SDK splits one options object across two wire channels — a small fixed argv set, and one stdin control
  request carrying everything else (system prompt, hooks, tool aliases, agents, skills). Hook registration is
  argv-invisible, so a diagnostic reading argv alone is blind to half the surface. Turn outcomes carry a
  thirteen-member terminal-reason union, which the adapter reads off the boundary frame.

**Tool surface control**

- Every backend carries the same eight-tool floor — read, glob, grep, write, edit, bash, web search, web fetch
  — set unconditionally: an empty capability frame yields the floor and an allow list narrows it, never widens
  it. Everything outside the floor was ungoverned, unrecorded, and unmatched on other backends. The seam that
  would demote a vendor built-in below that floor exists but ships **empty** — nothing is demoted today, so the
  floor is what the subscription path actually advertises. The posture is configuration rather than a default,
  and it ships off because the vendor path is currently the best-performing one and a change made for control
  that degrades it is a bad trade; a reader should not take the demote call as evidence something is removed.
- coa owns **no native tool implementation**: trained priors cover the whole contract including output shape
  (the numbered lines a read emits are what an edit's exact-match is calibrated against), so a substitute body
  under a native name would reproduce known upstream hazards for no gain.
- The native delegation tool is spelled inconsistently inside one version — the initialization frame advertises
  one name while the model emits another in the same live run — so every list that names it carries both
  spellings, and a drift test forces each generated tool schema to be classified on every SDK bump.
- Tool aliasing is honored at dispatch (live: a model-emitted native name ran coa's own handler, and the
  handler's output reached the model) — but an alias only **redirects** a name the harness already advertises,
  never publishes one. Per tool the choice is binary: keep the native tool advertised and alias it (own the
  implementation, inherit the vendor's schema and trained prior), or ship under coa's own namespace (own
  everything, no trained prior).
- System prompt: only the preset *object* preserves the harness baseline; an append field layers coa's text as a
  sibling; a raw string replaces the prompt outright; omitting the option sends an empty custom prompt, **not**
  the preset. The preset is a dial, not a switch, and the tool baseline is a separate preset on a separate
  channel.
- An empty setting-source list is not full isolation: it governs only the three filesystem settings files. The
  managed/policy tier still reads from disk, project MCP config needs the strict flag separately, skills
  discovery needs an explicit empty list (unset is not "off"), and a per-agent project-memory setting would
  still read target-repo files on a channel the setting-source list never touches. The adapter sets each of
  these explicitly.

**Session lifecycle, injection, and persistence**

- There is no silent mid-session system channel: a streamed system-role message is transmitted verbatim but not
  obeyed (live), while a non-querying user message *does* land in context and is recalled later but still costs
  a turn. Mid-loop delivery rides hook additional-context — the substrate the delivery queue is built on.
- Compaction is observable and schedulable, never vetoable. The compaction hooks have no specific output type
  and a generic block was ignored live, but coa gets full observation — both hooks, an in-band boundary frame
  with trigger, token counts and surviving messages, a context-usage read, and the post-compaction summary. A
  streamed manual compaction turn fires the pre-hook with the instructions verbatim, so coa can choose the
  moment and shape what survives. A hook firing is not proof compaction happened; the boundary frame is.
- A local on-disk session write is structurally required — the SDK's session store cannot be combined with
  persistence off, and the append hook is a mirror called after the local write succeeds. coa cannot be the only
  writer, but it **sites** the write via the config-directory environment variable and keeps its own log as the
  durable record: a session was fully reconstructed live from coa's mirrored log after the CLI's own store was
  deleted. Resume plumbing is plain argv, and the SDK does not enforce the documented session-id/resume
  exclusivity, so coa must.
- The config-directory variable does two jobs at once: credentials **and** the session store live in it, so
  redirecting the store also relocates the login (an empty directory reads as "not logged in").

**Process and environment**

- The environment option **replaces** the child environment entirely — an ambient variable absent from it does
  not reach the CLI (sentinel-verified), except that Windows re-injects a fixed set of system variables
  regardless. The auth overlay depends on this replacement.
- The base-URL variable genuinely redirects the real CLI's inference traffic (live-verified against a local stub
  server) — the premise for ever fronting the loop with an Anthropic-shaped gateway.
- The SDK's own budget option is a real enforced hard stop, but it surfaces as an exception **raised out of**
  message iteration rather than a result frame — anything rendering it must catch it, or a deliberate budget
  stop looks like a crash. Nothing budget-shaped exists per-agent or on the delegation tool's input, so a child
  cannot be ring-fenced by the vendor's own machinery.

The SDK's native subagent plane was measured in full and then archived: nothing shipped uses it, because
subagents are coa's own governed sessions instead. Kept in `archive/` for the record, including that hooks
around a native child cannot block its spawn (only a pre-tool deny of the delegation call can) and that the
*calling model*, not the host, picks a native child's permission mode on each spawn.

---

## Auth and browser profiles

coa stores **pointers, never secrets**. A user-global accounts file maps a label to a login — for the
subscription backend, a config-directory path holding a completed vendor login that coa never opens, parses, or
copies; for API-key providers, a stable mode-0600 key file written once and never read back. The active account
is tracked **per provider**, so switching one backend's login never disturbs another; a missing file is the
pass-through case (every provider ambient, empty list). Account ids are random rather than derived from an
email or label, since a derived id inherits their collisions and dies on a rename, and per-account side state
is keyed by it.

Selection is delivered per session through the backend's own environment-override option, never by mutating the
daemon's process environment, which would pin every concurrent session to one account. The overlay also
**clears** the ambient API-key and token variables that would silently outrank a subscription login, because
those force API-key billing and defeat the reason multiple subscription accounts exist. No accounts registered
means no overlay and byte-identical ambient behavior; recorded spend is attributed per account label.

**Login health is probe-derived.** Health comes only from the CLI's own status probe, never from reading token
files, which would breach credential-blindness and lie under silent token refresh. The probe's landed email is
the identity truth; a mismatch surfaces with keep-or-retry, and a broken *active* account is flagged with a
re-login action and **never silently rerouted** to another, since silent switching hides the problem. Health is
cached per daemon run and refreshed on view, refresh, or a live failure — no background polling.

**A login is a transition, not a state.** A flow completes only if the login directory *started clean*: the
manager probes a baseline concurrently with the CLI spawn and finalizes only from that baseline. A directory
that was already authenticated ends in a distinct "pre-existing" decision naming who it holds — use it or
cancel — instead of being reported as a successful login that never happened (closing the browser tab without
authorizing used to "succeed"). "Try again" is deliberately *not* one of the choices: it would only land the
same credentials again, and signing that directory out is the user's own action rather than coa's. A baseline
that cannot be established is treated as clean, so probe failure
degrades to the old behavior, and the verdict is enforced at the one completion funnel every probe-driven path
passes through. **Removal then deletes the login coa created, and only that**: the ownership test is a
path-containment check under coa's own logins root, failing toward *kept* because a config directory the user
pointed at is their data. There is no toggle — a login *is* the credential, and keeping it is what produced
phantom re-login surprises.

**Browser-profile isolation.** Isolated sign-ins launch a *real* browser (embedded windows are rejected by
identity providers) with per-identity cookie isolation via one Chrome profile directory per identity under a
**single shared** user-data directory — measured, since roughly ninety percent of a per-identity user-data
directory was shared machinery, not the login. Profiles are keyed by **identity, not account row** (a readable
slug plus a short digest of the email), because the jar caches a signed-in identity whose worth is being found
again; row-keying stranded unreachable megabyte-scale orphans and forced re-sign-ins. The cookie jar keeps its
own opt-in toggle, because a jar is a cache, not a credential.

The browser environment shim is a **courier**, not a launcher: it writes the CLI's self-completing authorize URL
to a file and exits, suppressing the CLI's own browser open, while coa performs the real open itself as an argv
spawn with **no shell in the path** — every failure in this lineage was a shell-quoting failure, so the class
was removed rather than patched. The shim exists because the URL the CLI *prints* and the URL it hands the
browser variable are different: the printed one ends in a code the user must paste back, the relayed one
completes itself against a localhost callback. Every failure degrades to copy-link plus paste-code, portable to
another device. Dead jars are reclaimed only through a surfaced list the user acts on, renamed before deletion
so an open window cannot leave a half-deleted jar — never by a background sweeper.

---

## Model catalog

The per-provider model list the pickers consume is the **user's editable list**, seeded from a hand-verified
shipped catalog. The backend's live model fetch is demoted to enrichment (capabilities, an "add from defaults"
affordance) because no backend reliably enumerates what actually works: the SDK advertises a handful of aliases
while a subscription honors explicit older ids it never mentions. Resolution runs user override, then live
fetch, then shipped catalog, then a bare runnable descriptor for an id no tier knows.

Never-cage holds structurally: an emptied list serves empty, a removed or hidden id still runs on the wire, and
an unknown hand-typed id assembles into something runnable — the backend is the real authority, and an invalid
id errors live rather than being blocked locally. Reaching a new model is a data change, not a rearchitecture. A
per-account capability cache fronts the fetch and never caches a rejected fetch, so a key-less provider fails
loudly rather than serving a silent empty list.

**A second catalog, deliberately separate, carries what a model *is*** — context window, price, modalities,
whether it reasons. The two are kept apart because their authority postures are opposite: coa curates the
enumeration list and the backend enriches it, but no backend enumerates its own context window or price over the
wire the way it enumerates model ids, so this one is a read-only merged mirror of public data coa has no
authority over at all. Three tiers merge in fixed priority, each later tier overriding only the fields it
actually carries: a hand-curated bundled floor, then a cross-provider public catalog, then a live routing-
provider feed for the ids that provider routes. Rows are keyed by provider **and** id together, so the same
underlying model reached through a router and through its native provider stays two rows.

The offline floor is the strict-superset rule applied to a network-fed catalog: construction is synchronous and
does no network work at all, seeding the bundled floor plus whatever the last successful refresh wrote to a
user-global disk cache, and refresh runs off the critical path, never throws, and pulls its sources
independently so a partial success still merges and persists what it got. A failed fetch resolves to *nothing*
rather than an empty list — the distinction is what stops a transient network failure overwriting good data with
emptiness. Absent fields stay absent: a model this catalog has no opinion about renders as honestly unknown,
never a guessed window and never a false "no vision", because an honest unknown and a fabricated denominator
look identical to a person right up until the number is wrong. The accepted cost is two similarly-named catalogs
a future reader must tell apart; folding them would force one's "coa is authoritative" posture onto data coa is
only mirroring.

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

## Skills and tool servers

Skills and external tool servers are first-class managed things, held in two declarative stores — one under the
user's home, one committed in the project. **The store file is the source of truth and every surface renders
it**: there is no cache to invalidate, an edit made in another window is visible on the next read without a
restart, and drift is computed on demand rather than watched, because a watcher would be a second source of
truth over files other tools own.

An entry is held in one of two link modes, and the product offers both explicitly rather than picking one and
hiding the trade. A **reference** is a pointer to a source path that every read re-resolves live — always
current, but not committable and not pinnable. A **copy** is materialized into the project store so it can be
committed and reviewed, carrying the source's content hash at copy time as a drift baseline — reproducible, but
it goes stale. Copying again is the one-click re-sync. Disabling an entry is surfacing-only: it stays listed and
is simply excluded from what consumes the library.

Discovery scans the machine for what is already installed rather than browsing a registry — local disk only.
Skills come from three well-known directories, one capability per subdirectory, followed through symlinks
because skill managers install them that way and a link may still name a real directory. Server configs come
from three configuration layers, with local shadowing project shadowing user, and a shadowed entry is **reported
as shadowed rather than hidden**. Anything already claimed by a store record drops out of the discovered list so
nothing appears twice, and every unreadable or unparseable file becomes a reported problem while the rest of the
scope still loads. A missing directory is the floor, not an error. Discovery has to explain what it did *not*
pick as well as what it did: a silent shadow or a silently skipped file is indistinguishable from an absent one.

An entry's name must be a single safe path segment, enforced at the schema rather than only at the write API,
because a copied skill's name becomes a directory under the store and removal deletes that directory
recursively — and the project store is a committed, clone-carried artifact, so a crafted name must never load as
a live record in the first place. The store file is otherwise deliberately **loose**: keys coa does not model
ride through a mutation verbatim, since a person is invited to hand-edit and commit it. A mutation refuses
outright when the file did not load cleanly, *before* any side effect fires — saving the lossy view back would
silently destroy content, the personal store has no version control to fall back on, and refusing before the
change function runs is what keeps a refused mutation from leaving half-materialized files behind.

**A skill reaches an agent as an ordinary knowledge piece**, which is what makes skills work on every backend
rather than being a vendor feature. The per-agent delivery choice maps onto the existing piece delivery axis:
injected pieces ride in the compiled prompt, on-demand pieces are advertised by name and description and pulled
by the existing piece-fetch tool. Foreign front-matter keys stay verbatim, and scope precedence is project over
personal by case-folded name — the same most-specific-wins fold the agent definitions already use. The resolved
selection joins the prompt's drift key, so a library change under a frozen prompt raises the drift notice.

The on-demand advertisement is **reconciled against the session's actual tool frame before the prompt compiles**:
if this session carries no piece-fetch tool the advertisement is dropped and the affected skills are named on
the turn's own feed. Advertising a tool the session does not have would fail the pull as tool-not-found with
nothing surfaced — the model would be told to reach for a hole. Silently promoting the skill to injected was
rejected: it rewrites the person's per-skill delivery choice, inflates the prompt without asking, and leaves the
recorded selection describing a prompt that was never compiled. Saying nothing, and saying why, is the honest
floor; the skill stays invocable by name.

A skill can also be **invoked explicitly for one turn**, expanding into that turn's own context rather than
recompiling the frozen system prompt — recompiling for a one-turn load would throw away the whole session's
cache warmth for a single use. The body renders as a tagged block above the person's text and persists as its
own system-role frame, so live delivery, the durable log and a later cross-provider replay all carry the same
bytes; live the backend receives one composed message while replay folds the block and the text as two, a
documented wire-shape difference.

An external server's tools are governed by the same seam as everything else and, because they are not in coa's
own catalogue, classify as commands — so under either asking mode every external tool call raises an approval,
and under read-only mode every one is refused. Fail-closed classification is what keeps an externally-supplied
tool from arriving pre-trusted.

---

## Console

`apps/desktop` is an Electron app in three parts, and the boundary between them is enforced.

**Main** owns everything privileged, now across many windows and many projects. In place of app-wide singletons
it keeps two registries: one of open windows, each tracking the project root it is bound to, and one of daemons,
one per project root, **reference-counted** by the windows bound to it. A daemon is spawned on the first window
that binds its project and killed the moment the last one releases it; a project already open in some window is
focused rather than opened twice, so two daemon processes can never hold one project's local state open at once
— which would mean two writers on the same append-only conversation and change logs. Refusing the second daemon
by *identity* rather than by presence is what makes an in-flight swap safe, and refcounting keeps the entry in
the map through a teardown so a release-then-reacquire in the same tick revives the same manager instead of
racing a second spawn. Every window-scoped call resolves which project it means from the calling window, never
from a global. Chrome — the shell arrangement, settings, theme — stays app-global and project-independent;
which projects are open, and the recent list, are persisted separately.

Main also owns per-user persistence of that arrangement, the window frame and zoom, and the two escape hatches
the renderer cannot have — revealing a file in the editor (spawned shell-free, worktree-confined) and opening a
validated web URL. Daemon status is a *transport* fact, not an RPC read, so main tracks it and pushes it on its
own channel. Stopping the
daemon goes over the pipe rather than by process id, so it also reaps a daemon this app did not spawn; a spawned
child is still tracked and killed as a fallback. Every failure carries its **reason** alongside the status,
chosen from a rolling stderr tail by preferring the *most recent* failure-shaped line and skipping stack frames
— the daemon reports its own routine trouble on stderr too, so the oldest error-shaped line in the window is
usually the least related to why the process just died.

**Preload** exposes one named function per verb, generated from a shared schema registry, plus three one-way
subscriptions (the daemon push stream, daemon status, window maximize state) — no raw IPC handle crosses the
bridge. The renderer's content-security policy is applied as a response header and is strict in production:
same-origin scripts only, no inline or eval, no network connections at all, since every data flow is IPC.
Development relaxes exactly two directives for the bundler's hot-reload preamble and websocket.

**Renderer** is a three-column workbench: a left nav of surfaces, a center canvas, and a collapsible right
column showing the active session's working state. Surfaces are chat, flags, timeline, auth, usage, agents, and
the library of skills and tool servers, plus a component showcase gated to development builds. The shell also
carries a project switcher over a recent-projects list, which opens a project in a new window, swaps the current
window to it, or focuses the window that already has it. Chat's title-bar segment is a session tab strip that
morphs into a session search; the composer carries an attach control and a context gauge; the right column shows
the root agent row, the session's plan checklist when it has emitted one, the family tree's subagent rows, its
isolated worktrees with the explicit reap, its spend roll-up, and a quiet "not tracked yet" line for things that
genuinely have no backing data.

**The console draws from push-fed slices, not one republished state object.** Five stores hold everything, and
nothing is published wholesale: a write lands in the one store whose subscribers actually draw it. **The shell
store** owns chrome only — the selected surface, work-versus-search mode, the tab working set and its reopen
stack, column widths and dock visibility, the daemon status badge, and the dialog set, with modal overlays
mutually exclusive by construction through a single shared close-all. Four more hold console state, split by
change cadence: slow **daemon data**, **session**-domain facts, per-session **transcripts**, and local **view**
state. Splitting by cadence is the point — it is what lets a streamed token touch exactly one session's
transcript entry while a poll tick returning unchanged data touches nothing at all. Reads settle into an
explicit loading/ok/error value that never throws, and the data store compares each polled key structurally so
an unchanged key keeps its reference.

A single **controller** is the composition root over those stores: it binds the injected bridge, owns push
routing and the boot sequence, and installs the action implementations, but holds no state of its own beyond a
per-connection attachment map, a counter for locally-rendered user turns, and a liveness flag. The stores are
module singletons that outlive it, so state kept in the controller would either duplicate them or strand on
teardown; keeping it a pure wiring layer is what lets a project swap tear it down and reboot it with the same
sequence a fresh window runs. The action surface is likewise a stable module-level object outside any store,
delegating to implementations installed at boot and a safe no-op before that — actions threaded into memoized
transcript rows must never change identity, or the memoization they were threaded through stops hitting.

One push subscription **fans out by kind, not by session**: a status push updates a run claim, a usage push
replaces that session's settled token counts, a mode push mirrors the daemon's permission-mode reflection, an
approval push queues an ask oldest-first, and a turn push is projected and appended to the *owning* session's
transcript rather than blindly to the active one. A terminal status flushes buffered stream frames first, so the
last streamed text is on screen before the running pill clears, and ends every pending ask for that session
since a request belongs to the turn that raised it. Frames buffer per session and flush once per animation
frame in one write covering every buffered session, because applying each delta synchronously would repaint per
token; the flush can be forced synchronously, which doubles as the guard against a throttled callback stranding
text behind a cleared status. Frame arrays are **append-stable** — previously-seen frames keep their object
identity — which is the precondition for the memoized rows.

**Every open tab is a mounted, live transcript host** subscribed to its own session's entry. A hidden tab keeps
streaming into real DOM and re-renders only when what it draws moves; activation is a display swap of
already-materialized DOM, with no frozen snapshots and no module-level per-tab frame maps. Materialization is
driven by the shell's tab set rather than by activation: any id entering the working set is subscribed and
hydrated immediately, so its later activation costs nothing. A whole restored strip materializes in one
staggered pass — the conversation on screen first, hidden tabs one at a time — while every claim registers
synchronously so a second pass cannot queue one twice; firing twenty full transcript reloads into one tick would
bury the one the user is actually waiting on. Reload is a cold-hydration and reattach path, never a switch path,
so re-selecting a warm session touches no I/O. When a reload does land on a warm entry, the durable log is
authoritative for everything it covers: reloaded frames replace the buffer up to the log's highest recorded
position and only live frames newer than that fold back on top. **Live-only announcements survive that merge**
as the deliberate exception, because the daemon never wrote them down, so yielding them to the log would erase
them rather than replace them with a truer version.

That exception needs a marker on the wire, and has one: live-only turns ride their own per-session numbering
space and are tagged as such, so the console gives them a separate id namespace. A live position and a persisted
position of the same number are two different turns; without the marker a console that identifies frames by
session and position collides them into duplicate row keys and a merge that erases an announcement while handing
its identity to an unrelated persisted frame. The marker is optional and additive, so an unmarked push stays a
persisted turn exactly as before.

Materialized transcripts are held to a **cap**, dropping the least recently used first, with recency tracked as
a monotonic counter rather than a clock — several transcripts routinely move inside one millisecond, and a clock
that steps backwards would make a just-opened conversation look coldest. The shell's open tabs and the active
session are never evictable at any cap, since each is a mounted host and dropping its entry would blank a tab
someone is looking at; the cap therefore bounds what is kept *beyond* the working set, which is a closed tab's
transcript kept warm so reopening it is free. It is enforced from the controller because only it knows both the
mounted set and the attachments — an evicted session still counted as attached would never re-hydrate and would
render empty forever — and checked on the push path as well as on tab movement, since checking only on tab
movement let the store float above the bound indefinitely in a window nobody is clicking around. **The cap's
value is provisional**: it is set to twice the roughly twenty-tab working set the instant-navigation acceptance
targets, and nobody has yet measured what a twenty-tab window actually holds in the running app, so it is a
placeholder awaiting that number rather than a settled policy.

A **project swap** resets the console stores at the boundary and reboots the controller, and every read that
outlives its controller lands nowhere: the controller carries a liveness flag its own teardown clears, and every
continuation that writes a store checks it first. Clearing alone would only be half of it — a session list or
transcript reload still in flight from the leaving project would settle afterwards and write that project's rows
into the new project's window. What survives a swap is what was never the project's: the user's settings and
this window's raw-output toggle. On boot the restored tab strip is pruned against the session list just read,
because the working set is per-project while the persisted layout is per-user, and a foreign id would otherwise
cost cross-project round trips, hold an error entry, and — sitting in the tab set — be protected from eviction
ahead of a transcript the user actually has. Deleting a session drops every per-session record the console
holds; a deleted parent's children keep theirs, since the daemon removes exactly one conversation and those
children are still real, possibly-running sessions.

A daemon coming up is handled as **two different events**. A transition into running while the boot reads are
still in flight is the ordinary launch race — the boot attachments run against that very connection, so nothing
is re-attached. A transition *after* boot settled means the previous connection died: every run claim is
forgotten, every attachment invalidated, and every open tab re-attaches. A session the new daemon does not hold
answers that it is not subscribed, which clears its stale run claim through the ordinary reattach path, and the
boot-time jump to the newest conversation only re-runs when nothing is active yet, so a mid-use restart never
yanks the user to a different conversation.

Approvals are live end to end: the newest unresolved ask is lifted out of the transcript and docked to the
composer, resolved asks stay in the transcript marked with their outcome, and the live queue comes from the
daemon's push stream and a reattach snapshot verb, taking priority over anything derived from transcript frames.
The raw projection deliberately **omits** approvals entirely — they are control, not conversation, and showing
them there would put console-originated chrome into the byte-faithful view.

The composer carries two honest-uncertainty surfaces. The **context gauge** meters how much of the active
model's window the session has consumed, computed from the last settled turn's real usage plus a live
character-based estimate of what is being typed; occupied context is fresh input plus prompt-cache reads plus
output, since cache reads are context even though they bill differently. It is an approximation on
multi-round-trip turns, so every surface rendering it wears an approximation mark, and a model whose window the
metadata catalog does not know renders a distinct honest-unknown state rather than a fabricated denominator. The
**attach control** gates on a tri-state verdict rather than a boolean: image attachment opens only on a verified
yes, while a verified no and an unverifiable model both disable it with their own stated reason, so a model the
catalog cannot vouch for never reads as confidently non-vision and never collects a file the send would then
refuse. "We checked and it can't" and "we can't tell" are different facts to a person deciding whether to try.
Text attachment needs no model capability, only a backend that carries attachments at all.

Three structural rules bind the renderer (the visual register, tokens, and authoring rules are
[UI.md](UI.md)'s): the GUI is a client, **never** a second source of truth (every action is a daemon verb, the
permission mode is mirrored from the daemon and never decided locally, and raw mode renders the daemon's frames
byte-faithfully, reachable from the command palette and a rebindable chord); **exactly one component** may
render a block, constructed only from a daemon-issued deny frame, since the console never originates a denial
itself; and the transcript is **unwindowed by design** — every frame is a real DOM node, kept cheap by rows
memoized on frame identity, because full-conversation text selection and native find are incompatible with row
windowing (the windowed foundation was built, used, and reversed on that evidence). Paint containment is
deliberately *not* used as the mitigation: it clips a row's children to the row box and cuts off the tool card's
intentional bleed.

Package shape follows the same "one thing each" discipline: `console-kit` is the vocabulary, `console-transcript`
is the one big surface built from it, and the dependency runs one way only — the transcript is deliberately
*not* a kit member, since admitting a single-consumer renderer of that size would carve a permanent exception
into the kit's discipline. Every kit member carries an enforced intent contract and a showcase specimen enforced
by test. `console-viewmodel` stays pure: it maps daemon results to render props and imports neither Electron,
React, nor the core.

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
caller ever set a ceiling, so the cap state was a constant and the deny branch was wired but could never fire —
the system carried the full plumbing of a block (options, budget math, budget forwarding to the backend, a deny
frame, its renderer copy) for a stop that could not happen. The alternative was to make the ceiling real; the
maintainer ruled against it, accepting the consequence with eyes open. What was kept is exactly what carried
the value: settlement, the counter, and the ledger.

Three consequences follow, stated plainly. **The close gate is the only thing coa itself decides to refuse with**
— "exactly two blocks" became exactly one, and the only other refusal in the system is the operator's own
permission mode, carried out through that same seam. **Fan-out and message traffic are both unbounded**: there
is no depth limit, width limit, or spend bound on a spawn tree, and nothing bounds a turn loop provoked by
agents messaging each other either — a pathological pair that keeps messaging will keep running turns. Either
runs until its work ends, the operator stops it, or the provider's own plan limit does (a depth check that
denied a spawn would itself be a second block, and a depth counter would only stop a chain, not a wide fan-out —
the vendor's own machinery offers nothing per-agent to ring-fence a child with). Messaging inherited this rather
than introducing it: the design it came from cited the dollar ceiling as its only bound, and that ceiling had
already been archived, so restating it would have been exactly the falsehood archiving was meant to stop. A
bound on fan-out is a **roadmap** item, most likely a real user-set ceiling over the kept counter, not a quiet
revival of the dead path. **The read surfaces report unbounded**: the cap read verb, the CLI cap command, and
the console's governed inspect read all still work and all report no ceiling; exposing real accumulated spend
through them is future work.

Cost itself is reported by the backend on Claude. On the pure-API path there is no dollar figure on the wire, so
coa computes one from the provider spec's price table — cache-hit input tokens billed at the cache rate when one
is configured, the rest at the input rate. **A model with no configured price entry costs zero**, the deliberate
floor: the accounting never guesses, so an unlisted model records as free until a price is supplied.

Three honest gaps today: the ledger accumulates in memory for the daemon's lifetime and no surface reads it or
writes it to disk; the console's Usage surface renders a **mock** ledger (labelled as such in its own source)
rather than the real one; and the session listing carries no cost, so the console's family-tree spend roll-up is
built and correct but always renders its "not tracked yet" floor. That third one is **not a wiring gap**, and
the earlier framing of it as one undersold the problem: the ledger's allow-list carries no session-identifying
field at all, and the one lineage field it does carry is stamped only on a *child's* record — deliberately, so
a root session's own spend stays lineage-free — which leaves a root's spend unattributable and every sibling
under one root indistinguishable from the next, while the daemon-global counter receives a session id and
ignores it. Meanwhile the consumer and the wire shape both already expect genuinely per-session numbers. A real
fix stamps a session id on every settlement, root and child alike, and aggregates over it: a data-model change,
not a read verb. Separately, the web-fetch summarizer's spend is
recorded to the ledger under its own scope but not charged to the session counter — a deliberate, named
deferral. The live smoke suites still run under a real-money guard, but that guard now rides a raw backend
session-option pass-through — the vendor's own budget stop, a test-harness concern rather than a governance
surface.

---

## Dormant substrate

Some machinery is kept deliberately, unfed, for a later governance era. It is not dead code by accident; it is
parked capability with a known revival condition. Where it had no caller at all it now lives under `archive/`,
which is excluded from compilation, linting, formatting, tests, dependency cruising, and the docs index — each
entry there records what it was, why it was parked, and what would revive it.

- **The symbol and graph layer.** The typed graph, the symbol table, the tree-sitter reparse path, the
  convention extractors, and the scope resolver are all present in `packages/core` and `packages/code-intel` and
  all tested. **Nothing in production populates the symbol table** — that is why the grounding producer was
  archived (it could only query a permanently-empty index) and why the symbol-reading tools are unregistered.
  What *is* live from `code-intel` is canonicalization, used by the generation-drift producer, and the import
  extraction the graph builds on. A revival starts clean: what populates the symbol table, and when, has no
  prior ruling to honor.
- **Health scoring.** A code-health signal producer composed cheap, language-agnostic signals — cycle tangle,
  coupling fan-in and fan-out, churn and hotspot from the change log, size — into a worst-of, never-scored
  profile with conservative starting cut-points, but was never constructed or registered by any path. It sits
  in `archive/` with its composition helper; both revive together once something calls them and the calibration
  pass its cut-points always awaited has happened.
- **The idle queue.** The daemon is resident precisely so idle pre-compute has somewhere to live: a priority
  scheduler with cancellable handles hangs off the kernel, flushing pending jobs highest-priority first. No
  production path registers a job today; regeneration, index building, context pre-assembly and detection
  sweeps are its intended tenants.
- **Lazy tool loading.** The catalogue is partitioned into an always-loaded kernel set and an on-demand set, and
  the discovery and load verbs over the on-demand half exist, but the proxy that would let a model discover and
  pull an on-demand tool mid-session is not wired — today the whole catalogue is registered and the partition
  only expresses intent.
- **Other parked entries** in `archive/` include the decision log and provenance layer, the flag auto-patch
  planner and reminder policy, the bundle importer and version gate, the write-only signal bus, the
  checkpoint-undo plumbing, the spec-conformance pair, the backend port-manifest shape, and the exploratory half
  of the SDK probe suite.
- **An older subagent frame kind** survives in the wire schema with a six-state event enum and **zero
  producers**, left in place deliberately rather than restructured when the three live announcement kinds were
  added beside it: removing it is a decision for whoever designs the real cards, not something to settle in
  passing. A reader of the wire types will find the shape and should not assume anything emits it.

The tree-to-transcript fold no longer sits here. Projecting a whole session tree as one ordered transcript was
built and tested with no production caller for a long time; it now has one, as the read a completion notice's
quoted excerpt is folded from — which is also why no second, narrower transcript-joining routine was ever
written beside it.

---

## Known debt

Honest and specific, re-derived from the tree on 2026-08-11. Several long-standing items closed in the two
stages since the last pass and are not listed: the daemon composition root not honoring its own root override
(startup now resolves one root and one home and builds every store from them, which was a precondition for one
daemon per project); the auth handlers computing key-file paths from the ambient home at nine separate sites;
the hand-rolled interrupt-and-steer flag machine (replaced by the one-state turn lifecycle above); the console
store's whole-object publish and its identity-selector subscribers; the transcript existing in three
renderer-side copies; and a tab-switch losing freshly-streamed frames. What follows survives, or is new.

**A permission-mode refusal has no dedicated surface.** The frame vocabulary the console and the terminal render
carries exactly one kind of stop — the close gate — so a mode refusal reaches the model as an ordinary
tool-permission denial and reaches the person only as the approval card's resolved state. In read-only mode,
where nothing is ever asked, the refusal has no console surface at all beyond whatever the model then says about
it. This is the mirror of the wired-but-never-fires cases named elsewhere: it fires, and has nowhere to land.

**The terminal client cannot answer a permission ask.** It subscribes to the daemon's push stream and renders
turn, status and cost records; an approval push falls through its switch and prints nothing, and it has no verb
to respond with. Since a session's default mode asks before any write or command, a session started from the
terminal against a model that writes should block on its first write and never proceed. This is a code-reading
conclusion, not a measured one — it has not been run — and it is a gap rather than a decision: the mode work
landed the daemon-side ask and the console-side answer, and the terminal client was not extended.

**The active session's frames are projected twice per render.** The chat surface builds its view model on every
render, walking the active session's whole frame array unmemoized, and the active tab's own transcript host then
projects the same array again inside a memo. The frame-identity caches make each element a lookup rather than a
rebuild, so the cost is an array walk plus an allocation rather than a re-render of rows — but the chat surface
subscribes to roughly a dozen store keys, so it happens often.

**Streaming reconciliation is linear in transcript length, per incoming frame.** Folding a coalesced batch
rebuilds the whole frame array per frame, so a batch of *k* frames on an *n*-frame transcript costs on the order
of *k×n* element copies per animation frame. The store port did not touch this path, and the append-stable
identity contract the memoized rows depend on is what constrains any fix. It is unmeasured, and it is the one
remaining per-frame cost that scales with conversation length.

**A reattach can drop an optimistic user echo.** The reload merge yields console-local frames to the durable
log: only live-namespaced announcements and frames newer than the log's highest position survive. A send whose
persisted frame has not yet reached the log, followed by a daemon restart, loses its optimistic echo. The code
states this as a deliberate rule — a reload only lands there when the daemon's record is the truer story — so
it is an accepted consequence rather than a defect, named here because it is invisible from the outside.

**The two-second poll.** Cap state, the flag feed and the timeline are refreshed by a fixed interval rather than
pushed. A per-key structural comparison in the data store keeps a quiet tick from touching any subscriber, and a
tick that moves one key leaves the other two reference-identical — but neither stops the three round trips, so a
change can land up to two seconds late. Push is the intended replacement, and the wire already defines flag and
drift push kinds that nothing emits.

**Three desktop panel suites had been seen failing intermittently under parallel load and were never
root-caused.** All three were rewritten by the console store port, so whether the behaviour survives is
unverified — re-derive it rather than carrying it forward on trust. The rule it was recorded under stands
regardless: an intermittent failure is a bug until proven otherwise, never permission to wave a red test
through. A failure of exactly this shape was chased once before and turned out to be a real defect, not a flake.

**The endpoint has no peer authentication.** The daemon binds with default socket and named-pipe security.
Unix peer-credential rejection and a Windows custom DACL are unreachable through Node's networking layer and
need a native addon. Acceptable for an attended single-user local product; it must close before any multi-user
or remote-daemon mode, because that endpoint is the approval and secret-read gate.

---

_Last reviewed: 2026-08-11_
