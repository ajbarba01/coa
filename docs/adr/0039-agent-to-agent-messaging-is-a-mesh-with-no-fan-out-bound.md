# 0039 — Agent-to-agent messaging is a mesh, with no fan-out bound

- Status: accepted
- Date: 2026-08-09
- Builds on [0030](0030-delivery-one-intent-realized-per-backend.md) (the `Delivery` port),
  [0033](0033-a-notice-is-not-a-message.md)/[0038](0038-a-completion-notice-may-quote-the-childs-own-result.md)
  (the completion notice's trust shape), and [0034](0034-a-subagent-is-a-session-with-a-parent-link.md)
  (lineage as a stored, walked-on-demand pointer). Deviates from
  [0032](0032-the-cost-cap-bounds-fan-out.md) as written, in agreement with
  [0035](0035-the-close-gate-is-the-only-block.md), which had already superseded it.

## Context and problem

`docs/superpowers/specs/2026-08-04-inter-agent-messaging-and-dispatch-design.md` designed
inter-agent messaging: mesh addressing within a root's family tree, a live roster, non-blocking
`send_message`, a durable message log distinct from the change-event spine, delivery keyed to
receiver state, graded-confidence liveness, and — as written — "the root cost cap is the only
bound" on a message-provoked loop. `docs/adr/0033` explicitly deferred this whole area: "Agent-to-
agent messaging... is explicitly out of this arc's build list." This decision is that later work,
landing alongside a `subagent` `TurnFrame` producer for the console (spawn/completion/message
cards).

Two things had moved since the design doc was written, and adopting it without checking either
would have shipped something already known to be false or already known to be worse than an
existing precedent:

1. **The design doc's own cost-cap claim is now stale.** `docs/adr/0035` (2026-08-07 — three days
   before this decision) archived the cost-cap deny path entirely: "nothing bounds subagent
   fan-out — not depth, not width, not spend," a deliberate, accepted state, not an oversight. A
   design that cites "the root cost cap is the only bound" as a Decision, unchecked, would restate
   machinery that no longer exists — exactly the failure ADR-0035 itself was written to stop
   ("dead machinery is a falsehood the code tells"). Applying that same discipline here rather
   than blindly adopting the doc's stale claim is the point of this ADR's first deviation, below.
2. **coa's actual turn model has no primitive for "inject into an idle session's model context
   without an owning turn."** The design's four-state delivery table (idle / mid-turn / finished /
   not-yet-started) reads as four distinct realizations; coa's `LiveSession`/`DeliveryQueue`
   machinery (ADR-0030) only has two: a `Delivery` drained from INSIDE an already-running turn, or
   a fresh `QueuedTurn` that wakes (or starts) a drive loop. Three of the four table rows collapse
   onto the second mechanism.

## Decision drivers

- **Compose, don't reinvent (P8).** The existing `Delivery`/`DeliveryQueue` mechanism (ADR-0030)
  and the existing `parent`/`root` lineage fields (ADR-0034) already carry everything a mesh needs
  — a second parallel channel for "agent talked to agent" would duplicate machinery this arc
  already built once for "text waiting to reach a running loop."
- **SC-1 honesty.** A signal this process did not itself observe must not be reported as though it
  were (the same principle `notify.ts`'s `SessionEndReason` — "no inferred or advisory reason" —
  already enforces for completion notices). The roster's graded confidence and this decision's
  liveness scope both follow from this directly.
- **Trust shape, not a new taxonomy.** ADR-0033/0038 already worked out exactly how an unforgeable
  daemon-authored envelope may safely quote model-generated, untrusted content (a completion
  notice's excerpt). An inter-agent message's body is the same category of thing — untrusted,
  agent-authored free text — so it gets the same treatment rather than a new trust model invented
  from scratch.
- **Minimal blast radius for a genuine schema gap.** Where coa's schema truly cannot express a
  needed distinction (a fresh turn's `input` has no role slot to mark "this came from a peer
  agent, not the human"), the fix is scoped to this module, not threaded through every adapter and
  the console, unless a future need actually requires it.

## Decision

**Messaging is a mesh within one root's family tree — any member may message any other, hierarchy
is provenance only — realized entirely on the two mechanisms coa's turn model already has, with no
fan-out bound beyond what `spawn_agent` already accepts.**

- **Mesh membership** (`packages/core/src/session/message-dispatch.ts`'s `dispatchMessage`): sender
  and target must share a root (`SessionMeta.root ?? id`, the same "root defaults to self"
  convention `LiveSession` already uses). A target with no known session at all is refused
  (`unknown-target`); a target in a different tree is refused (`out-of-tree`). Neither is a
  governance block — both are ordinary unapplied tool results, mirroring `spawnAgent`'s own
  never-throw-never-deny unknown-ref reply.
- **Thread identity.** Every message gets a daemon-generated `id`; a fresh message anchors its own
  thread (`threadId === id`); a reply carries the thread it replies into, resolved from the durable
  log (`replyTo` → the original message's `threadId`, falling back to `replyTo` itself if it
  doesn't resolve — never a throw). This is the `responseId`-as-thread-not-message pattern the
  Traycer spike flagged as adoptable and the critique named as a gap the design doc left unfilled.
- **Unforgeable sender id.** `from` is stamped by the daemon from the CALLING session's own
  `sessionId` (`SessionService.messagingFor`, bound at the same point `spawnFor` binds `parent` —
  never read from a tool argument). `SYSTEM_SENDER` (`message-log.ts`) reserves the literal string
  `'system'` for a future daemon-authored broadcast; nothing produces one yet, closing the
  critique's third named gap (cheap now, expensive to retrofit into a shipped log schema later).
- **The durable log** (`message-log.ts`) is one append-only `.ndjson` file per family-tree root
  under `.coa/local/messages/` (gitignored, alongside the conversation store) — never the
  change-event spine, for the same category reason ADR-0033 gives for a completion notice:
  conversational traffic is not a fact about what changed in the codebase.
- **Delivery realizes on exactly two mechanisms**, chosen by the receiver's CURRENT live state:
  - **Mid-turn** (`session.state === 'running'`): the message rides the existing
    `Delivery`/`DeliveryQueue` mechanism, `origin: 'system'` — the envelope ("a message arrived,
    from whom") is a fact this process itself observed, exactly like a completion notice's own
    envelope; the body enters only as sanitized, quoted, bounded data (`message-render.ts`'s
    `renderMidTurnDelivery`, same flatten-and-cap treatment `notify.ts`'s `detail`/`result` already
    get). Persisted with `role: 'system'`, distinguishable from the human's own words.
  - **Wake** — idle (registered, parked at `nextTurn()`), not currently registered (idle-evicted),
    or not yet started: none of these three can be reached by a queue push alone (nothing is
    draining it), so the caller enqueues a fresh turn (`SessionService.#wake`), reviving the
    `LiveSession` via `getOrCreate` when needed (lineage reconstructed from the STORE's permanent
    `parent`/`root` — the live registry has no record of an evicted session) and deriving
    role/model/roles/packageIds/exclude from the recipient's own agent definition, mirroring
    `#startChild`'s founding-turn derivation exactly.
- **The roster** (`message-dispatch.ts`'s `buildRoster`, the `list_agents` tool) is
  relationship-relative, not a flat list — every tree member labeled `self`/`parent`/`child`/
  `ancestor`/`descendant`/`other` relative to the caller, closing the critique's second named gap
  (Traycer's proven answer, adopted directly). Each row also carries a liveness reading with graded
  confidence: `'observed'` for a currently-registered session (running or idle) or one whose end
  this PROCESS itself watched (`SessionService`'s new `#lastEnd` map, populated at the same
  `#emitStatus` seam the completion notice already uses); `'advisory'` for a session neither
  registered nor ever observed ending by this process (an idle-eviction, or a session from a prior
  daemon lifetime) — never fabricating an observation nobody made.

### Deviations from the design doc, and why

1. **No cost-cap-bounded fan-out — because there is no cost cap left to bound it with.** The
   design doc's Decision states "the root cost cap is the only bound... keeps SC-1 intact at
   exactly two blocks." `docs/adr/0035` (three days prior) already narrowed SC-1 to exactly ONE
   block (the close gate) and archived the cap's deny path as dead code. Messaging inherits
   exactly what `spawn_agent` already accepted under ADR-0035: nothing in-system bounds a
   message-provoked turn loop — not depth, not width, not spend — and the operator's own Stop plus
   the provider's own plan limit are the real backstops, precisely as ADR-0035 already decided and
   accepted for spawning. This is the discipline ADR-0035 itself modeled — recognizing dead
   machinery and not restating it as though it still worked — applied here rather than re-imported
   from a design doc that predates it.
2. **No "cancelled thread, do not resend" liveness enforcement at send time.** The design doc's
   liveness section calls for telling a sender not to re-send into a thread whose receiver was
   cancelled. coa's session model has no "permanently dead" session to detect: a torn-down
   conversation is always resumable by sending to its id again (`SessionService.send`'s
   send-or-create semantics already establish this for every ordinary top-level conversation), and
   `#wake` extends the identical behavior to a message target. Refusing to wake a torn-down
   session would be inventing a restriction the rest of the product does not have. The roster still
   reports a torn-down session's last observed end reason (high confidence when this process saw
   it happen) so a sender CAN decide not to bother — but `send_message` itself does not hard-block
   on it.
3. **No proactive "your thread went quiet" push notice.** The design doc's Stage 3 verification
   asks for a sender to be told, unprompted, when a thread goes unanswered. Building that
   correctly needs a wall-clock silence threshold — a genuine, undecided tuning knob, not free
   engineering — so it is PARKED, not shipped half-built (the same ruling this arc already applied
   to the tree cost roll-up, ROADMAP.md item M). What ships instead: the roster's graded-confidence
   liveness read is available on demand (re-query `list_agents`), which is the honest floor a
   sender can act on today; a timer-driven push notice is named, explicit follow-up work.
4. **The "wake" realization uses a bracketed envelope, not a widened schema.** A fresh turn's
   `input` has no role slot distinguishing "a peer agent said this" from "the human said this" —
   only `Delivery.origin`/the persisted `text.role` enum do, and only for a MID-turn delivery.
   Widening `Delivery.origin`/`TurnFrame`'s `text.role` to a fourth value would have rippled through
   every adapter's own delivery-rendering function and the console's role-label mapping for a
   distinction only the wake path needs. Instead, `message-render.ts`'s `renderWakeInput` prefixes
   an explicit `[coa: inter-agent message]` marker — the same bracketed-provenance idiom the
   codebase already uses everywhere this exact gap shows up (`renderDelivery`'s `[The user sent
   this while you were working]`, `deniedNotice`'s `[Stopped by coa: ...]`,
   `INTERRUPTED_BY_USER`). A real schema widening is a named, deliberately deferred follow-up, not
   attempted here.
5. **The `subagent` `TurnFrame` kind is extended by ADDING three new top-level kinds
   (`subagent-spawn`/`subagent-completion`/`subagent-message`), not by restructuring the existing
   `subagent` kind in place.** The existing kind's 6-state `event` enum has zero production
   producers (confirmed by grep) and would have forced a shape change through `console-viewmodel`'s
   `turn-map.ts` and `console-transcript`'s already-designed, hand-styled subagent row component
   (icons, status dots, Watch/Stop affordances) — real visual design work explicitly out of THIS
   arc's scope ("the actual card rendering is the next phase's job"). Three new `t` values fall
   through `turn-map.ts`'s existing `default: return undefined` branch untouched (the same
   graceful-degrade every other not-yet-mapped kind already gets), so zero console-package files
   needed touching; only `transcript-projection.ts`'s exhaustive switch gained three `break`
   arms (a live-only frame carries no transcript memory, same as every other `subagent-*` case).
   The old `subagent` kind is left in place, unused — removing it is a UI-owning decision for
   whoever designs the real cards, not this decision's to make.
6. **The three announcement frames are LIVE-ONLY, never persisted.** `SessionService.#announceSubagent`
   pushes a `kind: 'turn'` frame straight onto the session's live subscriber fan-out, using a
   per-session counter distinct from the turn's own persisted `seq` — never `store.append`. This
   mirrors the EXISTING `status`/`cost`/`mode` pushes exactly, and sidesteps a real risk a
   persisted version would have carried: `spawn_agent`/`send_message` can fire mid-turn (the
   parent's own tool call), racing against that same turn's own recorder-owned `seq` counter — an
   independently-computed `seq` writing into the same append-only log risks colliding with what the
   recorder is about to write for the very tool call that triggered the announcement. Solving that
   properly needs the announcement routed through the recorder's own drain point (the mechanism
   `Delivery` already uses) — a real change, named here as follow-up, not attempted under this
   decision's scope. A reload will not show a `subagent-*` card; only the live stream does.

## Consequences (good / bad)

**Good**

- Zero new realization machinery: every message rides `Delivery`/`DeliveryQueue` (mid-turn) or the
  ordinary turn queue (`wake`) — the exact two things ADR-0030/ADR-0011 already built and this
  arc's whole session layer already trusts.
- The mesh, roster, and durable log are all pure functions over data the daemon already has
  (`SessionMeta`, the live registry) plus one small addition (`#lastEnd`) — no second index to
  keep in sync, matching ADR-0034's "lineage is stored, not walked from a maintained structure"
  precedent.
- `send_message`/`list_agents` are ordinary governed tools — `PreToolUse` gates them exactly like
  every other call, no new governance surface, no new deny path to audit.

**Bad**

- A message loop has no bound whatsoever (deviation 1) — inherited, not introduced, but worth
  naming plainly: a pathological pair of agents that keep messaging each other will keep running
  turns until the operator stops it or the provider's plan limit does.
- The wake path's provenance marker (deviation 4) is a text convention, not a schema guarantee — a
  sufficiently adversarial peer agent's message body could in principle try to imitate the bracket
  format. The body is still sanitized (control chars flattened, length-capped) before it rides
  inside the envelope, and the bracket itself is daemon-composed, never agent-supplied, so this is
  the same trust shape ADR-0038 already accepted for a completion notice's quoted excerpt — but it
  is honestly a text idiom, not a type-level distinction, until a real schema widening lands.
- Live-only announcement frames (deviation 6) mean a console reload cannot show a subagent card
  history — only what happened to still be live-subscribed when it fired. Persisting them properly
  is real, scoped follow-up work, not a silent gap.

---

_Last reviewed: 2026-08-09_
