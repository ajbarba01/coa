# Agent hardening — OSS prior art & coa gap analysis

> **Research spike (time-boxed, read-only).** Surveys how mature OSS coding-agent harnesses handle the
> hardening concerns in `docs/superpowers/specs/2026-07-06-coa-agent-hardening-design.md` (goals G1–G7),
> validates coa's planned approach against convergent practice, and does a gap analysis of what coa is
> missing. Not a commitment; input to Plans A2 / E and the G4 work. Verify any load-bearing claim against
> the cited source before building on it.

Harnesses surveyed: **Aider**, **OpenAI Codex CLI** (Rust `codex-rs` + app-server), **Cline**,
**Continue**, **Goose** (Block), **OpenHands** (v1 Agent SDK), and **opencode** (sst). Claude Code is
referenced as the behavior coa's spec explicitly mirrors.

---

## 1. Executive summary — top 5 takeaways

1. **coa's G1 fix is exactly the industry pattern, and Codex proves the protocol.** OpenAI's `codex-rs`
   app-server exposes precisely coa's two verbs: `turn/interrupt` (in-flight turn ends with
   `status:"interrupted"`, **output generated before interruption is preserved**) and `turn/steer` (inject
   user input into the running turn without a new turn). coa's "safe-boundary interrupt + queued steer +
   keep-and-mark partial text" is convergent, not novel — which is reassurance, not a red flag.
   [Codex app-server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

2. **The strongest divergence signal is persistence.** OpenHands v1 and opencode are both built on a
   **single append-only event log as the sole source of truth** — "replaying it reconstructs the entire
   conversation." coa's plan keeps its **two-store split** (`turns.ndjson` incremental UI view +
   `messages.json` full-rewrite canonical) and papers over the divergence with flush-on-exit. flush-on-exit
   *correctly fixes the reported bug*, but the two-store design is the thing every mature harness moved
   *away* from. See §4-G1 and the gap in §5. [OpenHands events](https://docs.openhands.dev/sdk/arch/events),
   [opencode event bus](https://deepwiki.com/sst/opencode/2.8-storage-and-migration-system)

3. **Session independence (G4) is a solved, converged pattern: headless server + reattachable clients over
   an event stream.** opencode (`opencode serve` → OpenAPI + SSE `/event`, multiple clients resubscribe and
   receive synchronized state), Goose (`goosed` per-session agents), and Codex (app-server threads, `resume`)
   all put liveness in the server and make the UI a stateless subscriber. coa's G4 ("daemon authoritative,
   console is a stateless reattachable viewer") matches this cleanly. [opencode server](https://opencode.ai/docs/server/)

4. **Streaming (G7) is table-stakes everywhere; coa is the outlier for *not* having it.** Every harness
   streams token deltas (Codex `item/agentMessage/delta`, opencode SSE `message.updated`, Cline inline
   markdown, Aider, Continue). coa emits one text block per round-trip today. The plan (streaming
   `complete()` + a text-delta `TurnFrame`) is right; the only real design choice left is delta-frame shape.

5. **The biggest *feature* gaps are checkpoint/undo and context compaction.** Cline (shadow-git checkpoints
   with three restore modes), Aider (`/undo` on per-edit auto-commits), and Claude Code (`--rewind-files`
   file-history) all give the user a **revert** primitive; every serious harness has **context compaction**
   for long sessions. coa has neither. Neither is in the G1–G7 scope, and that is a defensible cut for the
   attended v0 — but they are the top "future" items (§5).

---

## 2. Per-dimension comparison

### Dimension 1 — Interrupt / cancel

| Harness | Boundary | In-flight model call | Partial output | On-disk edits already made |
|---|---|---|---|---|
| **Aider** | Cooperative `Ctrl-C` | Aborts generation | **Kept** in conversation; you can reply referencing it | Edits are auto-committed per-edit → survive as git commits ([git](https://aider.chat/docs/git.html)) |
| **Codex CLI** | `turn/interrupt` verb | Cancels turn → `status:"interrupted"` | **Preserved** (fork mid-turn snapshots as if interrupted) | Sandbox-scoped writes already applied stay on disk ([app-server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)) |
| **Cline** | User "interrupt at any point" | Aborts | Partial rendered; task can be redirected/rolled back via checkpoints ([plan-act](https://docs.cline.bot/core-workflows/plan-and-act)) | Reverted via shadow-git checkpoint if desired |
| **Continue** | Stop button | Aborts stream | Partial shown | Tool calls gated by permission before they run |
| **Goose** | "Interrupt it to correct its actions" | Cooperative abort on `Stream<AgentEvent>` | Partial kept | — ([agents](https://block-goose.mintlify.app/concepts/agents)) |
| **OpenHands** | New event appended to stop loop | Loop halts at event boundary | Events already emitted persist (append-only) | Observations already in log ([events](https://docs.openhands.dev/sdk/arch/events)) |
| **Claude Code** | Esc | Interrupts, emits `[Request interrupted]` | **Kept + marked** | `--rewind-files` file-history for revert |

**Convergent practice:** cooperative abort at a safe boundary; **partial assistant text is kept** (often
marked); in-flight *tool* calls that never completed are dropped. Nobody hard-kills mid-tool-write and
leaves a torn file silently.

### Dimension 2 — Steering / queuing

| Harness | Mechanism | Boundary vs restart |
|---|---|---|
| **Codex CLI** | `turn/steer` appends user input to the in-flight turn; returns the accepting `turnId`; review/compaction turns reject it | Injected into running turn (not a restart) |
| **Cline** | Interrupt → redirect the task | Interrupt-then-redirect |
| **Goose** | Interrupt to "provide additional information" | Interrupt-then-inject |
| **Aider** | Reply after `Ctrl-C` referencing the partial | Next turn |
| **OpenHands** | Append a user Action to the EventStream | Consumed at next loop boundary |

**Convergent practice:** steering = inject at the next safe boundary, **not** interrupt-and-restart. Codex is
the cleanest reference and matches coa's "queue to the interrupt boundary, push into `messages` before the
next round-trip."

### Dimension 3 — Streaming output

| Harness | Model | Partial-block-on-interrupt |
|---|---|---|
| **Codex CLI** | JSON-RPC notifications `item/agentMessage/delta`, `item/started`/`item/completed` | Preserved on interrupt |
| **opencode** | Central event bus → SSE `message.updated` deltas to all clients | Persisted via event log |
| **Cline** | Inline markdown renders as it streams | Kept |
| **Aider / Continue** | Token streaming (Continue converts tools to XML in system msg, parses stream) | Kept |
| **Goose** | `impl Stream<Item = AgentEvent>` | Kept |
| **coa (today)** | **One whole `text` frame per round-trip** (`driver.ts:118`) — no streaming | n/a |

**Convergent practice:** delta streaming is universal; the transcript-of-record still stores the *whole*
assistant text (streaming is a delivery concern). coa's G7 framing ("streaming changes delivery, not the
stored transcript") is exactly this.

### Dimension 4 — Turn/transcript persistence & crash recovery

| Harness | Model | Source of truth |
|---|---|---|
| **OpenHands v1** | **Single append-only `EventLog`**; "replaying it reconstructs the entire conversation" | The event log ([DeepWiki](https://deepwiki.com/All-Hands-AI/OpenHands/12.2-event-storage-and-replay)) |
| **opencode** | Central **event bus**, persisted; clients rebuild state by replaying/subscribing | The event stream ([bus](https://deepwiki.com/sst/opencode/2.8-storage-and-migration-system)) |
| **Codex CLI** | Thread transcript + plan history + approvals; `resume <id>` replays | The thread transcript |
| **Aider** | Append-only `.aider.chat.history.md` + **git commits per edit** (disk == git) | Git history is the durable edit record ([faq](https://aider.chat/docs/faq.html)) |
| **Cline** | Message log + **shadow-git** snapshot after each tool use | Conversation + shadow git |
| **coa (today)** | **TWO stores**: lossy incremental `turns.ndjson` (per-frame append) + `messages.json` (full rewrite, written only on clean settle) | Split — the bug source |

**Convergent practice:** one append-only substrate that *is* the source of truth; disk edits are reconciled
to that log (OpenHands observations) or to git (Aider/Cline shadow git) so a mid-turn failure can't diverge
disk from conversation. coa is the only surveyed design with a **two-store, write-canonical-only-on-clean-
settle** shape — which is the exact structural cause of the G1 defect (`driver.ts:184` /
`claude-sdk-adapter.ts:279` skipped on a throw). See §4-G1.

### Dimension 5 — Session independence / headless

| Harness | Server | Attach/detach |
|---|---|---|
| **opencode** | `opencode serve` headless HTTP + OpenAPI + SSE `/event`; multiple clients resubscribe, get synchronized events, 30s heartbeats | Stateless reattachable clients ([server](https://opencode.ai/docs/server/)) |
| **Goose** | `goosed` server, **agent-per-session**, many concurrent sessions, isolated channels | UI attaches to server ([discussion](https://github.com/block/goose/discussions/4389)) |
| **Codex CLI** | app-server (JSON-RPC over stdio), threads, `codex resume <id>` | Reattach by thread/session id |
| **OpenHands** | Session = one EventStream + one Runtime; server-hosted | Replay log to rehydrate |
| **coa (plan)** | **Daemon authoritative** for liveness; console hydrates run-state on connect | The G4 goal |

**Convergent practice:** liveness lives in the server; the UI is a subscriber that hydrates on connect and
never reconstructs run-state from its own in-flight tracking. coa's G4 is squarely on this line — today's
defect (run-status is UI-local, lost on reload, `console.ts`) is precisely the anti-pattern these harnesses
avoid.

### Dimension 6 — Permissions / capability modes

| Harness | Modes | Enforcement |
|---|---|---|
| **Codex CLI** | Read-only / Auto / Full-access; `/permissions` to switch live; OS sandbox scoping (workdir, network) | Approval policy + OS sandbox ([features](https://developers.openai.com/codex/cli/features)) |
| **Cline** | **Plan vs Act**; per-step approval; auto-approve toggle (Shift+Tab) with thresholds | Per-tool approval gate |
| **Continue** | Per-tool policy `allow`/`ask`/`automatic`; read-only default-allow, writes/Bash default-ask; `~/.continue/permissions.yaml` | Tool-name predicate ([tool-permissions](https://docs.continue.dev/cli/tool-permissions)) |
| **Claude Code** | Plan mode (read-only), allow/deny lists, per-tool | `canUseTool`-style predicate |
| **Goose** | Permissions/safety policies per extension (MCP) | Policy layer |
| **coa (plan G2)** | Tool-level allow/deny on `canUseTool`; plan-mode as a **read-only capability preset**; agent-default + chat override | Deterministic per-tool DENY predicate |

**Convergent practice:** enforcement is a **tool-name predicate**, not heavy machinery; plan/read-only is a
preset over that predicate; per-tool ask/allow/auto is the common vocabulary. coa's G2 (deny on the existing
`canUseTool`, plan-mode as a preset, first-deny-wins fail-closed) is textbook and lighter-weight than most
(no separate approval-policy engine because coa's SC-1 keeps enforcement to a single deny channel).

### Dimension 7 — Other major hardening / UX features observed

| Feature | Who | Notes (for §5 gap analysis) |
|---|---|---|
| **Checkpoint / undo** | Cline (shadow-git, 3 restore modes), Aider (`/undo` on auto-commits), Claude Code (`--rewind-files`) | coa has none; Cline's shadow-git is the gold standard |
| **Context compaction** | Claude Code (5-layer pipeline), Codex (handoff-summary compaction, user msgs verbatim), opencode, Amp | Universal for long sessions; coa has none |
| **Subagents** | Claude Code (fresh isolated context, summary return), coa plans D122 depth-1 fan-out | coa deferred; strong pairing with compaction |
| **Sandboxing** | Codex (OS sandbox, network gating), OpenHands (Docker runtime) | coa has M7 process-isolation posture + POSIX confine (floored) |
| **Diff review** | Cline, Aider architect | coa M6 diff engine not built |
| **Todo/plan tracking** | Codex (plan history), Claude Code (todos) | coa: "someday" |
| **Retries/backoff, @-mentions, recipes/rules** | Various (Goose recipes, Continue rules, Aider reflection) | Adjacent; not core hardening |

---

## 3. coa plan validation (Step 4 verdicts)

**Verdict scale:** MATCH (convergent with OSS), DIVERGE-justified, DIVERGE-watch.

### G1 — block-preserving interrupt / error / steering
- **Safe-boundary interrupt, keep-and-mark partial text, drop only incomplete tool block, queue steer to the
  boundary** → **MATCH.** Codex's `turn/interrupt`+`turn/steer` are the same two verbs with the same
  semantics; "output preserved before interruption" and "review/compaction turns reject steer" mirror coa's
  boundary rules almost exactly. Nothing in the plan's *behavioral* contract diverges.
- **flush-on-exit `try/finally` + settle-usage on error/interrupt** → **MATCH** as a bug fix. This is the
  right minimal correctness patch and lands the block-preserving invariant.
- **Keeping the two-store design** (flush-on-exit as the reconciliation mechanism instead of collapsing to
  one append-only substrate) → **DIVERGE-watch.** Every mature harness surveyed (OpenHands, opencode, and
  effectively Aider/Cline via git) treats **one append-only log as the source of truth** and reconciles disk
  to it. coa keeps a canonical store that is only written on clean settle and bolts on flush-on-exit to
  cover every exit path. That *works*, but it means correctness now depends on remembering to flush on
  **every** future exit path (a new early-return re-opens the exact bug). The event-sourced single-substrate
  pattern makes the invariant structural rather than disciplinary. **Recommendation:** ship flush-on-exit now
  (it's the small, safe fix and unblocks the phase), but log an ADR/roadmap item to converge `turns.ndjson`
  and `messages.json` onto a single append-only event log — coa already has the M1 change-event spine as a
  precedent for exactly this shape. *Not a "plan is wrong" — a "plan is locally right, globally deferring the
  real fix."*

### G2 — capabilities as per-tool DENY on `canUseTool`; plan mode as preset
- **MATCH**, and arguably cleaner than peers. Continue (`allow`/`ask`/`automatic` per tool), Cline
  (plan/act + per-tool approval), Codex (`/permissions` modes) all converge on a tool-name predicate; coa's
  "deny on the existing predicate, first-deny-wins, fail-closed, plan-mode = read-only preset" is the same
  model with the SC-1 discipline of a *single* deny channel (no parallel approval engine). Divergence from
  peers (no interactive per-call approval UI, enforcement-only) is **justified** by coa's headless-agent
  target — headless agents don't sit on prompts, so a deterministic deny is the correct primitive.
- Watch item (already flagged in the spec): confirm the **pure-API vs SDK** tool-scoping coverage gap
  (ADR 0005's two gates) so plan mode denies mutation on *both* backends. Peers get OS-sandbox scoping
  (Codex) essentially for free; coa's pure-API path must enforce in-predicate.

### G4 — daemon-authoritative liveness; console as stateless reattachable viewer
- **MATCH.** This is the exact opencode/Goose/Codex model. coa's proposed proofs (reload renderer mid-run →
  session still reads running; hydrate run-state on connect) are the right acceptance tests. The three
  hydration options in the spec (summary field / snapshot read / re-emit on subscribe) all appear in the
  wild; **opencode's "server re-sends state + heartbeats on (re)subscribe"** is the most robust and argues
  for the re-emit-on-subscribe option (self-healing across dropped connections) rather than a one-shot
  snapshot read. Consider a heartbeat/keepalive on the pipe (opencode uses 30s) so a dead console is
  detectable.

### G7 — streaming deltas, all backends
- **MATCH.** Universal practice; coa is currently the outlier for lacking it. The plan's shape (streaming
  `complete()` returning an async-iterable of deltas terminating in the settled `CompletionResult`;
  non-streaming adapter degrades to one final delta per D85; canonical `messages.json` still stores the
  whole text) is consistent with how everyone separates *delivery* (deltas) from *record* (whole message).
  The one open choice (new `TurnFrame` kind vs a flag on `text`) is genuinely coa-local; peers model it as a
  distinct delta event (`item/agentMessage/delta`, `message.updated`), which argues mildly for a **distinct
  delta frame kind** over overloading `text`.

**Net:** coa's G1(behavior)/G2/G4/G7 plans MATCH convergent OSS practice; the one structural divergence worth
tracking is keeping the two-store persistence design instead of a single append-only substrate.

---

## 4. Gap analysis (Step 5) — what coa lacks vs mature harnesses

Priority = impact on getting real work run *through* coa agents robustly. Size is rough.

### High
- **Streaming output (G7)** — *in scope.* [High, M] Every harness has it; coa emits whole blocks. Directly
  affects perceived responsiveness and the interrupt-keeps-partial story. Already planned (Plan E) — keep it.
- **Single append-only event substrate** — *fold into this phase as a follow-on to G1.* [High, M] The
  two-store split is the structural root of the G1 bug and diverges from all surveyed harnesses. flush-on-exit
  is the tactical fix; converging to one log (reuse the M1 spine pattern) is the durable one. If not done now,
  it should be an explicit ADR + roadmap item, not silent.
- **Live deny/approval surfacing (R-12 WAL→Push)** — *already keystone 1, correctly out of this phase.*
  [High, L] Peers surface tool approvals/denials live; coa's is inert pending R-12. Not this phase, but it's
  the single biggest gap between coa and e.g. Cline/Continue's per-tool UX.

### Medium
- **Checkpoint / undo (revert primitive)** — *future.* [Med, M] Cline (shadow-git), Aider (`/undo`), Claude
  Code (`--rewind-files`) all give the user a one-action revert. coa has M6 fork/worktree deferred and no
  undo. For attended v0 the user has their own git; for unsupervised Phase-3 agents this becomes important
  (a bad autonomous run needs a clean rollback). **Recommendation: pair with the worktree manager (item I),
  not this phase.**
- **Context compaction / long-session survival** — *future.* [Med, M–L] Universal in mature harnesses; coa
  has none. Attended short sessions don't need it, but unsupervised graveyard-extraction runs will hit the
  window. coa's frozen/cached-prompt work is orthogonal (cache warmth, not compaction). **Pairs naturally
  with subagents (item I / D122).**
- **Interrupt/steer transport verbs** — *in scope via G1/Plan A2.* [Med, S–M] coa has no interrupt path
  today; the JSON-RPC pipe needs `interrupt`/`steer` verbs analogous to Codex's `turn/interrupt` /
  `turn/steer`. This is the concrete deliverable of Plan A2 — Codex's README is a ready-made protocol
  reference.
- **Heartbeat/keepalive + reattach re-emit on the pipe** — *fold into G4.* [Med, S] opencode's 30s heartbeat
  + re-emit-on-subscribe make session independence robust to dropped connections. coa's G4 should adopt
  re-emit-on-subscribe rather than a one-shot snapshot.

### Low
- **Diff review surface** — [Low, L] M6 diff engine deferred; peers (Cline/Aider) show a diff before/with
  edits. Nice UX, not a robustness blocker for attended v0.
- **Todo/plan tracking** — [Low, S] Codex plan history / Claude Code todos. coa has it under "someday."
  Cheap and improves multi-step legibility, but not hardening.
- **Interactive per-tool approval modes (ask/auto thresholds)** — [Low, M] Continue/Cline expose graded
  auto-approve. coa's SC-1 single-deny + headless target makes this deliberately out of scope; only revisit
  if attended interactive UX becomes a goal.
- **OS-level sandboxing parity** — [Low, M] Codex/OpenHands sandbox at the OS/container level; coa's M7 has a
  process-isolation posture + floored POSIX confine. Fine for local-first single-user; revisit for untrusted
  autonomous runs.

**Explicitly NOT gaps** (coa deliberately narrower): interactive approval UI, multi-user, OS sandbox
hardening — all justified by local-first/single-user/attended-v0 constraints and SC-1.

---

## 5. Recommendations feeding Plan A2, Plan E, and G4

**Plan A2 (interrupt + steering)**
1. Model the transport on **Codex's app-server verbs**: an `interrupt(threadId,turnId)` that ends the turn
   with an explicit `interrupted` status, and a `steer(threadId, userInput)` that returns the accepting
   session/turn id. Reuse the same safe boundary for both (after a tool result is persisted, before the next
   `complete()`), exactly as the spec states.
   [ref](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
2. **Reject steer on non-steerable turns** (coa's equivalent of Codex rejecting steer on review/compaction
   turns) — define which coa turn states accept injection.
3. Keep the block-preserving contract as the acceptance test: interrupt mid-*text* keeps + marks the partial
   (Claude Code `[Request interrupted]`); interrupt mid-*tool* drops only the uncompleted call; **reconcile
   on-disk edits to the conversation** on every exit path.

**Plan E (streaming)**
1. Emit a **distinct delta frame kind** (append-to-current-block), not a flag on `text` — matches how Codex
   (`item/agentMessage/delta`) and opencode (`message.updated`) model it and keeps the whole-`text` frame as
   the settle record.
2. Preserve the **delivery-vs-record split**: stream deltas to the console; still write the whole assistant
   text to the canonical store. This is universal and already in the plan.
3. Build E on A1's flush-on-exit/safe-boundary loop (as sequenced) so a mid-stream interrupt flushes the
   partial text through the same path.

**G4 (session independence)**
1. Put liveness in the daemon; make the console hydrate on connect. Prefer **re-emit `status` on
   (re)subscribe** over a one-shot snapshot read — it self-heals dropped connections the way opencode's bus
   does. [ref](https://opencode.ai/docs/server/)
2. Add a **heartbeat/keepalive** on the pipe (opencode: 30s) so a dead console is detectable and a running
   headless session is unaffected by console churn.
3. Acceptance test exactly as specced: reload the renderer mid-run → session still reads *running*.

**Cross-cutting (flag, don't necessarily build now)**
- Open an **ADR** for the persistence direction: ship flush-on-exit for G1, but record the intent to converge
  `turns.ndjson` + `messages.json` onto a **single append-only event log** (the pattern OpenHands/opencode
  converged on, and one coa already has in the M1 spine). This turns the block-preserving invariant from a
  discipline into a structural property.
- Sequence **checkpoint/undo** and **context compaction** as the top two *future* (post-phase) items, both
  paired with the deferred worktree/subagent work (roadmap items I / D122) — they are what unsupervised
  Phase-3 runs will need next after G1–G7.

---

## Sources

- Aider — [git integration](https://aider.chat/docs/git.html), [edit formats](https://aider.chat/docs/more/edit-formats.html), [commands (Ctrl-C/interrupt)](https://aider.chat/docs/usage/commands.html), [faq](https://aider.chat/docs/faq.html)
- Codex CLI — [app-server README (interrupt/steer)](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md), [features/sandbox](https://developers.openai.com/codex/cli/features), [app-server docs](https://developers.openai.com/codex/app-server)
- Cline — [plan & act / checkpoints / auto-approve](https://docs.cline.bot/core-workflows/plan-and-act), [repo](https://github.com/cline/cline)
- Continue — [tool permissions](https://docs.continue.dev/cli/tool-permissions), [how agent mode works](https://docs.continue.dev/ide-extensions/agent/how-it-works)
- Goose — [agents concept](https://block-goose.mintlify.app/concepts/agents), [per-session agents discussion](https://github.com/block/goose/discussions/4389)
- OpenHands — [events (append-only, replay)](https://docs.openhands.dev/sdk/arch/events), [event storage & replay](https://deepwiki.com/All-Hands-AI/OpenHands/12.2-event-storage-and-replay), [SDK paper](https://arxiv.org/html/2511.03690v1)
- opencode — [server (headless serve + SSE)](https://opencode.ai/docs/server/), [event bus / storage](https://deepwiki.com/sst/opencode/2.8-storage-and-migration-system)
- Claude Code — [how it works](https://code.claude.com/docs/en/how-claude-code-works), [context compaction analysis](https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f)

---

_Research spike — not a commitment; input to Plans A2 / E / G4. Verify load-bearing claims against sources before building._

_Last reviewed: 2026-07-06_
