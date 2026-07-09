# Append-only conversation persistence — OSS mechanics deep-dive

> **Research spike (time-boxed, read-only).** Follow-on to
> [`2026-07-06-agent-hardening-prior-art.md`](2026-07-06-agent-hardening-prior-art.md), which established the
> strategic signal (OpenHands v1 and opencode both converge on a single append-only log as the sole source of
> truth) and fed [ADR 0010](../../adr/0010-append-only-conversation-log.md) (accepted, execution deferred). That
> survey did not go below the "replaying reconstructs the conversation" headline. This spike goes to source-code
> level on the six load-bearing unknowns for the actual fold design: event vocabulary, the fold to a provider
> transcript, crash/interrupt integrity, materialized-vs-computed projections, streaming-delta placement, and
> concrete pitfalls. A third harness — **OpenAI Codex CLI (`codex-rs`)** — was pulled in because its
> `normalize_history` / `for_prompt` code turned out to be the cleanest, most explicit implementation of exactly
> the fold coa is designing, and having three independent implementations converge is stronger evidence than two.

Harnesses: **OpenHands v1 Agent SDK** (`OpenHands/software-agent-sdk`), **opencode** (`sst/opencode`, now
resolves to `anomalyco/opencode` — same codebase, ownership/rename), **OpenAI Codex CLI** (`openai/codex`,
`codex-rs/core/src/context_manager`). All claims below are cited to a specific file/function read via GitHub's
raw content or code-search API in this session, unless marked **[unverified]**.

---

## 1. Executive summary

1. **All three harnesses fold the append-only log to a provider transcript at read time, right before the LLM
   call — never by mutating the durable store.** OpenHands: `state.view` (derived) → `events_to_messages()`.
   opencode: `WithParts[]` (SQL rows) → `toModelMessagesEffect()` → `convertToModelMessages()` (Vercel AI SDK).
   Codex: `ConversationHistory::for_prompt()` (consumes an owned copy, never writes back). coa's plan to fold at
   read time is exactly convergent practice, not a compromise.
2. **Dangling tool calls are repaired at that same read-time fold, and the dominant pattern is *synthesize a
   paired error result*, not *drop the orphaned call*.** Codex's `ensure_call_outputs_present` and opencode's
   `toModelMessagesEffect` both insert a synthetic `tool_result`/`output-error` (`"aborted"` /
   `"[Tool execution was interrupted]"`) for any tool call missing its result. OpenHands's primary path
   (crash-recovery `AgentErrorEvent`, matched by `tool_call_id`) does the same; only a defense-in-depth
   `ToolCallMatchingProperty.enforce()` *drops* an action if a paired result never shows up by view-construction
   time. **coa's plan to drop the trailing dangling `tool_use` diverges from the convergent practice** — see §7.
3. **"Trailing" is the wrong frame — the general case is *any unmatched tool call in the folded window*, not
   just the last content block.** Parallel tool-call batches (a single LLM turn emitting N tool calls) mean a
   mid-batch call can be the one left dangling on interrupt, not the last one. Codex and OpenHands both key
   repair off `call_id`/`tool_call_id` set membership, not position.
4. **Streaming deltas never enter the durable log in any of the three harnesses**, and one of them (opencode)
   has a filed, fixed regression that is directly relevant to coa's next phase: persisting every delta caused
   excessive I/O and perceptible lag; the fix was to make deltas a pure, unpersisted pub/sub event and only ever
   write the settled block. Codex filters deltas out of the rollout file by an explicit allow-list
   (`is_persisted_rollout_item`). OpenHands's streaming is a `token_callbacks` side-channel, architecturally
   separate from the `Event`/`EventLog`.
5. **Projections are computed-on-demand with an in-memory incremental cache, not a second durable store.**
   OpenHands's `state.view` is lazily maintained: an O(k) tail-append fast path on linear growth, full rebuild
   (`View.from_events`) only on cold load / fork / navigation / error recovery. opencode computes the provider
   array fresh at call time from SQL rows that are already close to UI shape (no separate provider-transcript
   table). This validates ADR 0010's "one durable log, projections derived" direction and gives coa a concrete
   answer for the perf question the ADR didn't resolve: cache the fold result in memory, not on disk, with a
   cheap-append/full-rebuild-on-anomaly split.

---

## 2. Q1 — Event vocabulary / granularity

### OpenHands v1: `Event` → `LLMConvertibleEvent`

Source: `openhands-sdk/openhands/sdk/event/base.py`, `event/llm_convertible/{action,observation}.py`.

- **`Event`** (base, Pydantic, immutable): `id` (uuid4), `timestamp` (ISO), `source`, `parent_id` (optional —
  supports a conversation *tree*, not just a list, for fork/navigation).
- **`LLMConvertibleEvent(Event)`**: abstract `to_llm_message() -> Message`. Subclasses: `MessageEvent` (user/
  agent chat text), `SystemPromptEvent`, `ActionEvent`, `ObservationBaseEvent` (→ `ObservationEvent`,
  `UserRejectObservation`, `AgentErrorEvent`), `CondensationSummaryEvent`.
- **`ActionEvent`** — one event **per tool call**, not per LLM turn. Fields: `thought` (text before the call),
  `reasoning_content`, `thinking_blocks` (Anthropic), `responses_reasoning_item` (OpenAI Responses API),
  `action` (typed `Action | None`), `tool_name`, `tool_call_id`, `tool_call` (verbatim `MessageToolCall` kept
  so it round-trips losslessly back into a `Message`), `llm_response_id` (groups **parallel** tool calls from
  one LLM turn — see §6), `security_risk`, `critic_result`, `summary`.
- **`ObservationBaseEvent`**: `source="environment"`, `tool_name`, `tool_call_id`. `ObservationEvent` adds
  `observation` (the tool's typed result) and `action_id` (points back at the originating `ActionEvent`).
- **Yes — tool call and tool result are always separate events**, paired by `tool_call_id` (and `action_id`).
  A parallel batch of N tool calls from one LLM response is N separate `ActionEvent`s sharing one
  `llm_response_id`, each later paired 1:1 with its own `ObservationEvent`.

### opencode: `Message` (top-level turn) → `Part[]` (content unit)

Source: `packages/opencode/src/session/message-v2.ts`; DeepWiki 2.2 (message-and-prompt-system).

Two SQL tables (`MessageTable`, `PartTable`, Drizzle/SQLite), each row storing a full serialized JSON blob
(`data` column) plus `id`/`session_id`/`message_id`. Seven `Part` variants, discriminated union:
`TextPart` (+ `synthetic`/`ignored` flags), `ReasoningPart` (`start`/`end` timestamps), `FilePart` (3 source
variants: path/LSP-symbol/MCP-resource), `ToolPart` (**state machine**: `pending → running → {completed |
error}`, fields `callID`, `tool`, `state.input`, `state.output`/`state.error`, `state.time`, `state.attachments`,
`metadata`), `SubtaskPart`, `CompactionPart`, `StepStartPart`/`StepFinishPart` (generation-step boundaries,
cost/token metrics). **A tool call and its result are the same `ToolPart` row transitioning state, not two
separate parts** — this is opencode's one real divergence from OpenHands/Codex's separate-event model, and it
is why opencode's dangling-call repair (§4) is a state check (`pending`/`running`) rather than a
presence/absence-of-a-second-event check.

### Codex CLI: `ResponseItem` (provider-native) inside a `RolloutItem` envelope

Source: `codex-rs/state/src/extract.rs:20-29`, `codex-rs/rollout/src/recorder.rs:59-62` (via DeepWiki 3.5.2).

`RolloutItem` is an enum: `ResponseItem` (the actual model-turn content — `Message`, `Reasoning`,
`FunctionCall`, `FunctionCallOutput`, `LocalShellCall`, `ToolSearchCall`/`Output`, `CustomToolCall`/`Output`,
`Compaction`, …), `EventMsg` (protocol-level: `UserMessage`, `TokenCount`, …), `SessionMeta`, `TurnContext`,
`Compacted`, `InterAgentCommunication`, `WorldState`. `RolloutLine` wraps a `RolloutItem` with a UTC timestamp.
Notably, **Codex's event vocabulary is provider-shaped already** — `ResponseItem` is close to the literal
OpenAI Responses API item — unlike OpenHands/opencode, which keep a richer intermediate representation and
fold it down. Tool call and output are separate `ResponseItem` variants (`FunctionCall` /
`FunctionCallOutput`), paired by `call_id`.

**Takeaway for coa:** the two-event-per-tool-call model (OpenHands, Codex) is more common than the
single-mutable-part model (opencode) and is simpler to reason about for the "was this paired" question — a set
membership check on `call_id`s, no state machine needed. Recommend coa's enriched event vocabulary keep tool
call and tool result as **separate, immutable events** linked by a stable call id, matching OpenHands/Codex
rather than opencode's stateful-part model.

---

## 3. Q2 — The fold to a provider transcript (the crux)

All three have an explicit, named function, and all three call it fresh, right before/as part of the LLM
request — none pre-store the provider array.

- **OpenHands**: `LLMConvertibleEvent.events_to_messages()` (static, in `event/base.py`) — filters to
  `LLMConvertibleEvent`s, groups consecutive `ActionEvent`s sharing an `llm_response_id` into one assistant
  message with a multi-entry `tool_calls` array (`_combine_action_events`), maps by role
  (`MessageEvent[user]→user`, `MessageEvent[agent]/ActionEvent→assistant`, observations→`role="tool"`
  keyed by `tool_call_id`). Called via `prepare_llm_messages(state.view, condenser=..., llm=...)` in
  `agent.py`'s `step()`/`astep()` — comment: *"Prepare LLM messages from the cached, incrementally-maintained
  view"* (references SDK issue #3053). `to_llm_message()` is per-event (`ActionEvent.to_llm_message()` returns
  `role="assistant", tool_calls=[self.tool_call]`; `ObservationEvent.to_llm_message()` returns
  `role="tool", tool_call_id=self.tool_call_id`).
- **opencode**: `toModelMessagesEffect(input: WithParts[], model, options)` in `message-v2.ts` — walks
  `Message+Part[]` rows, builds provider-shaped `UIMessage[]` (handling per-provider media-in-tool-result
  support, empty-message filtering, a documented Anthropic thinking-block/step-start ordering hack — see §6),
  then calls the Vercel AI SDK's `convertToModelMessages()` to get the final `ModelMessage[]`. Invoked from
  `LLM.stream()` (`session/llm.ts`) at call time — **not cached**.
- **Codex**: `ConversationHistory::for_prompt(self, input_modalities) -> Vec<ResponseItem>` in
  `context_manager/history.rs:141` — doc comment: *"Returns the history prepared for sending to the model."*
  Takes `self` **by value** (an owned copy), calls `normalize_history()` (§4) then drops non-API items, then
  returns; the original in-memory history and the on-disk rollout are untouched.

**Tool_call ↔ tool_result pairing reconstruction:** OpenHands and Codex both reconstruct pairing by a
`call_id`/`tool_call_id` **set-membership check** across the full item list (not sequential scanning assuming
adjacency) — this is what lets them handle out-of-order arrival and multi-call batches correctly. opencode
doesn't need to "reconstruct" pairing since call and result live in the same `ToolPart` row/state machine.

**Do they store provider messages directly, or derive from richer events?** All three **derive** — none of
the three persists a `messages: [{role, content, tool_calls}]`-shaped array as its source of truth. This
directly matches coa's chosen approach (enriched event stream, provider transcript derived).

---

## 4. Q3 — Crash / interrupt integrity at read time (validates/refines the `dropTrailingDanglingToolCall` plan)

This is where the three harnesses gave the most concrete, most load-bearing code, and where coa's current plan
needs a real adjustment, not just validation.

### OpenHands: two-tier — synthesize first, drop as a defense-in-depth fallback

- **Tier 1 (primary):** `ConversationState.get_unmatched_actions()` (`conversation/state.py`) finds
  `ActionEvent`s with no matching `ObservationEvent`/`UserRejectObservation`/`AgentErrorEvent`, searching the
  event list **in reverse** ("recent events are more likely to be unmatched" — a stated perf reasoning). Its
  docstring: *"AgentErrorEvent is matched by tool_call_id (not action_id)... important for crash recovery
  scenarios where an error event is emitted after a server restart."* **[unverified: I could not trace the
  exact call site that emits the `AgentErrorEvent` on restart — inferred from this docstring and from
  `ObservationUniquenessProperty`'s docstring below, not directly read.]**
- **Tier 2 (fallback, defense-in-depth):** `View.enforce_properties()` (`context/view/view.py`) runs a
  fixed-point loop over `ALL_PROPERTIES` (`context/view/properties/__init__.py`):
  `ObservationUniquenessProperty` (registered **first**, deliberately — see below), `BatchAtomicityProperty`,
  `ToolCallMatchingProperty`, `ToolLoopAtomicityProperty`. Any property that must actually fire **logs a
  warning**, because *"enforcement is intended as a fallback to inductively maintaining the properties... any
  time a property must be enforced a warning is logged."*
  - `ToolCallMatchingProperty.enforce()` (`properties/tool_call_matching.py`): builds the set of
    `tool_call_id`s that appear on an `ActionEvent` and the set that appear on an
    `ObservationBaseEvent`; **any `ActionEvent` whose id is missing from the observation set is dropped**
    (and symmetrically, any orphaned observation is dropped too). Docstring: *"Some providers (for example
    Anthropic tool use) require every tool_use to have one corresponding tool_result... so duplicate
    observation-like events are not safe to silently tolerate."*
  - `ObservationUniquenessProperty` exists **specifically because of Tier-1 crash recovery**: *"Crash recovery
    can synthesize an AgentErrorEvent for an in-flight tool call and then the original ObservationEvent may
    still arrive late, so the view ends up with two observation-like events sharing a single tool_call_id...
    This property is registered ahead of ToolCallMatchingProperty so the duplicate is dropped before pairing
    logic runs."* First occurrence wins.
  - `View.from_events()` runs `enforce_properties` once at full-rebuild time; `View.append_event()` is the O(1)
    incremental path that assumes properties already hold and doesn't re-check them per-append.

So OpenHands's real practice is: **try to produce a real or synthetic paired result as close to the crash as
possible (tier 1); if any dangling call still slips through by the time a view is materialized, drop it as a
last resort (tier 2), and treat that drop as a logged anomaly, not the expected path.**

### opencode: synthesize, always, at fold time — no separate repair pass

Source: `message-v2.ts` lines ~349–362 (read directly):

```ts
// Handle pending/running tool calls to prevent dangling tool_use blocks
// Anthropic/Claude APIs require every tool_use to have a corresponding tool_result
if (part.state.status === "pending" || part.state.status === "running")
  assistantMessage.parts.push({
    type: ("tool-" + part.tool) as `tool-${string}`,
    state: "output-error",
    toolCallId: part.callID,
    input: part.state.input,
    errorText: "[Tool execution was interrupted]",
    ...
  })
```

No drop path exists in opencode for this case — every `ToolPart` still `pending`/`running` at fold time gets a
synthetic `output-error` result inserted inline. This is a **single-tier** design (simpler than OpenHands's) —
opencode is willing to always synthesize rather than distinguish "recently crashed, might still resolve" from
"genuinely orphaned."

### Codex: synthesize (both directions), by explicit invariant enforcement, deterministic and unpersisted

Source: `codex-rs/core/src/context_manager/normalize.rs`, called from `history.rs:141` (`for_prompt`) via
`normalize_history()` (`history.rs:359`, doc comment: *"enforces a couple of invariants... 1. every call has a
corresponding output entry 2. every output has a corresponding call entry"*):

```rust
pub(crate) fn ensure_call_outputs_present(items: &mut Vec<ResponseItem>) {
    // ... build function_output_ids / tool_search_output_ids / custom_tool_output_ids sets ...
    ResponseItem::FunctionCall { id, call_id, .. }
        if !function_output_ids.contains(call_id.as_str()) =>
    {
        missing_outputs_to_insert.push((idx, ResponseItem::FunctionCallOutput {
            id: synthetic_output_id("fco", id.as_deref()),
            call_id: call_id.clone(),
            output: FunctionCallOutputPayload::from_text("aborted".to_string()),
            ..
        }));
    }
    // ... inserted immediately after the call, in reverse index order to avoid re-indexing
}

pub(crate) fn remove_orphan_outputs(items: &mut Vec<ResponseItem>) {
    // symmetric case: a FunctionCallOutput/ToolSearchOutput/... with no matching call_id
    // among FunctionCall/ToolSearchCall/LocalShellCall/CustomToolCall is dropped
}
```

Two details worth calling out explicitly for coa:

1. **The synthetic output id is deterministic** (`Uuid::new_v5` over a fixed namespace + `"{prefix}:{source_id}"`),
   with an explicit comment: *"Prompt normalization can run repeatedly without persisting its synthetic
   outputs, so the namespace and name format must remain stable across retries and resumes to preserve
   prompt-cache reuse."* This is the single most directly actionable line in this whole spike for coa, which
   already treats cache warmth as a first-class concern (frozen-prompt work, memory: "session-hardening-status").
   A repair that regenerates a *different* synthetic id/text on every fold would invalidate the provider's
   prompt cache on every turn after an interrupt.
2. **`ensure_call_outputs_present` runs inside `for_prompt(mut self, ...)`, which consumes `self` by value** —
   i.e. it always operates on a disposable copy assembled fresh for that one request. The synthetic item is
   never written back into the persisted rollout or the long-lived in-memory `items` — it exists only in the
   vector handed to the model.

### Verdict for coa

**All three synthesize a paired result as the primary/majority behavior; only OpenHands additionally has a
drop-based fallback, and only as a last-resort safety net that logs a warning when it fires (i.e., it's
explicitly *not* meant to be the normal path).** coa's plan — `dropTrailingDanglingToolCall`, applied as the
sole mechanism — is the *minority* pattern (present nowhere as a primary strategy) and is scoped too narrowly
even on its own terms (see §1.3 — "trailing" vs "any unmatched call_id"). See §7 for the concrete
recommendation.

---

## 5. Q4 — Projections: materialized vs. computed

- **OpenHands**: hybrid — the *durable* store is the flat event log only. `ConversationState.view` is an
  **in-memory, lazily-maintained cache**, not a second durable store (`state.py`, read via search since direct
  fetch 404'd on the exact path but confirmed via the surrounding `agent.py` call sites and property
  docstrings): fast path replays only the tail when the new leaf is a linear descendant of the cached leaf
  (O(k) where k = new events since last read); full rebuild (`View.from_events`, which runs
  `enforce_properties`) on cold load, fork, navigation, or **error recovery**. `rebuild_view()` is the explicit
  escape hatch, called on malformed-history retries.
- **opencode**: the SQL rows (`MessageTable`/`PartTable`) *are* the durable log, and they are already close to
  UI shape (a `ToolPart`'s `state` field is directly renderable). The provider-shaped array is **never cached**
  — `toModelMessagesEffect` runs fresh on every `LLM.stream()` call. There is no separate "canonical transcript"
  table.
- **Codex**: durable store is `rollout.jsonl` (`RolloutItem`/`RolloutLine`, append-only, `is_persisted_rollout_item`
  filters what's written). The in-memory `ConversationHistory.items` is loaded/replayed from it and is the
  working copy the agent mutates turn-to-turn; `for_prompt()` computes the provider array fresh from a clone of
  that in-memory state on each call — again, no separate persisted provider-transcript store.

**Convergent answer: one durable log; at most one in-memory derived cache (OpenHands); the provider-shaped fold
itself is never cached anywhere, in any of the three.** This directly supports ADR 0010's direction and answers
the open perf question: if computing the fold from scratch on every turn becomes a measurable cost for coa (long
sessions), the OpenHands pattern — an in-memory, incrementally-appended view with full-rebuild-on-anomaly — is
the concrete, precedented way to get speed back **without** reintroducing a second durable store or the
sync-discipline problem ADR 0010 exists to kill.

---

## 6. Q5 — Streaming deltas: delivery-only, never in the durable log

- **opencode** — direct source read, `session.ts`: `updatePartDelta()` **only** does
  `events.publish(MessageV2.Event.PartDelta, input)`; there is no `db.insert`/`db.update` in that function.
  Confirmed architecturally by `packages/opencode/src/sync/README.md`: the codebase has two event tiers —
  `Bus` events (ephemeral, pub/sub only) and `SyncEvent`s (durable, sequenced, replayed, "projected" into SQL).
  The README states plainly that sync events were introduced for *"all of the [session events] that mutate the
  db"* — `PartDelta` was deliberately **not** upgraded to a `SyncEvent`; it stays a plain `Bus` event. Only the
  settled counterpart (`PartUpdated`, via `updatePart()`) is a sync event that gets durably recorded.
  **Documented pitfall (opencode issue #11329, "Slow perceived response time due to excessive storage writes
  during streaming"):** an earlier version *did* call `Storage.write` (JSON file) on every `reasoning-delta`,
  causing "hundreds of file writes per second" and visible lag; the filed fix was "accumulate content in
  memory, flush every 50ms, always flush on `reasoning-end`." The current SQL-backed code (read above) has
  gone further than that fix — it doesn't persist deltas **at all**, only the bus broadcast.
- **Codex** — `is_persisted_rollout_item` (`codex-rs/rollout/src/policy.rs`) explicitly filters ephemeral items
  like `EventMsg::PlanDelta` out of what gets written to `rollout.jsonl`.
- **OpenHands** — streaming is `token_callbacks` registered on `Conversation` (`docs/sdk/guides/llm-streaming`),
  receiving raw `ModelResponseStream` chunks. This is architecturally a side-channel from the `Event`/`EventLog`
  — the docs give no indication (and I found no code path) where a delta becomes an `Event`; the settled
  `ActionEvent`/`MessageEvent` is what's appended, once, after the LLM call resolves. **[unverified: I did not
  trace the exact code point where the streamed response is reduced into the final `ActionEvent` — this is a
  reasonable inference from the callback API's shape and the Event model's "immutable, complete capture"
  design described in the SDK paper, not a directly read line of code.]**

**Verdict: unanimous.** None of the three harnesses puts streaming deltas in the append-only/durable store.
coa's plan to add streaming without touching the durable log is exactly right, and opencode's issue #11329 is a
concrete warning shot: if coa ever gives the UI a "resume mid-stream on reconnect" feature, do **not** persist
per-delta; buffer in memory and coalesce, or (opencode's current, stronger answer) don't persist partial text at
all and treat a reconnect mid-stream as "you rejoin the live channel or you see the last settled block," never
a partially-written durable record.

---

## 7. Q6 — Concrete pitfalls / gotchas

- **Parallel tool-call batches must live or die atomically** (OpenHands `BatchAtomicityProperty`,
  `context/view/properties/batch_atomicity.py`): when one LLM turn emits N tool calls sharing an
  `llm_response_id`, and any condensation/forgetting step drops even one of the N `ActionEvent`s, **all N must
  be dropped together** — a partial batch would desync the assistant message's `tool_calls` array from what was
  actually paired. Directly relevant to coa once multi-tool-call turns are in scope: an interrupt-repair that
  operates per-call-id in isolation (as Codex's does) is fine for the *interrupt* case (each call still gets
  its own synthetic result), but a future *condensation/summarization* feature would need this batch-level
  invariant, not a per-event one.
- **Thinking/reasoning blocks impose ordering constraints tied to tool loops** (OpenHands
  `ToolLoopAtomicityProperty`): *"Anthropic models with thinking enabled... expect the first element of such a
  tool loop to have a thinking block, and use some checksums to make sure it is correctly placed. If we remove
  any element of the tool loop we have to remove the whole thing."* A generic "drop this one event" repair is
  unsafe once extended thinking is involved — you must drop the whole action/observation run the thinking block
  opened.
- **Late-arriving real results after a synthesized crash-recovery result** produce duplicate `tool_result`s
  for one `tool_call_id` (OpenHands `ObservationUniquenessProperty`) — first occurrence wins, everything else
  is dropped, logged. Relevant if coa's loop driver can, after emitting an interrupt/error event, still have an
  in-flight tool call's real result land afterward (a race between the abort signal and the tool's own
  completion).
- **Provider-specific tool-call-id format quirks** (opencode `provider/transform.ts`, per DeepWiki 4.3): Claude
  requires alphanumeric+underscore IDs, Mistral requires exactly 9-character alphanumeric IDs — opencode
  normalizes IDs per-provider at fold time. Not urgent for coa today (Claude-primary), but a reminder that "fold
  to provider transcript" is provider-parameterized, not a single fixed function, the moment a second backend's
  literal wire format diverges from Anthropic's.
- **A documented ordering hack for signed reasoning blocks** (opencode `message-v2.ts`, read directly): *"Anthropic
  adaptive thinking can persist assistant turns like: step-start, reasoning(signature), text(""), step-start,
  reasoning(signature). The empty text part is a structural separator... dropping it shifts signed thinking
  positions after step-start splitting/provider regrouping... preserving a non-empty separator here is the only
  safe replay point we have."* A concrete example of a real, hard-won gotcha that only surfaces once
  extended-thinking + multi-step turns are exercised in production — the kind of thing no design doc predicts
  and only a fold implementation with production mileage discovers. Filed here as a "expect surprises like this"
  flag, not something to pre-build for.
- **Cache-warmth-breaking synthetic repairs** (Codex, §4): a repair that regenerates non-deterministic content
  (a fresh UUID, a timestamp-stamped message) on every fold invalidates the provider's prompt cache on every
  subsequent turn. Any synthetic tool_result coa's fold inserts for a dangling call must be **deterministic**
  given the same input event stream.
- **Streaming write amplification** (opencode issue #11329, §6): don't persist per-delta; already covered above,
  repeated here because it's the single most concrete "don't repeat our mistake" artifact this spike found.

---

## Recommendation for coa

**Does convergent practice support "one enriched event stream, derive the provider transcript by a read-time
fold with a trailing-dangling-tool_use trim"?**

- **The "one enriched event stream, read-time fold" half: yes, strongly.** All three harnesses do exactly this
  — a single durable append-only substrate, a named fold function invoked fresh at/near call time, provider
  messages never persisted as such. Ship this as designed; ADR 0010's direction is validated at the mechanics
  level, not just the strategic level.
- **The "trailing-dangling-tool_use trim" half: no — this is the one place to change the plan before building
  it.** Concretely:
  1. **Synthesize a deterministic paired result, don't drop, as the default repair.** Insert a synthetic
     tool-result event (e.g. `content: "[interrupted]"` or similar, matching coa's existing interrupt/error
     vocabulary) for any tool_use left unmatched by the point of fold, keyed by a **stable, deterministic id**
     derived from the original call's id (Codex's `Uuid::new_v5` pattern) so repeated folds of the same
     interrupted turn don't perturb the prompt-cache prefix. This keeps the assistant's tool_calls array
     structurally intact and keeps the record legible ("the agent tried X, it was interrupted") instead of
     making the attempt vanish.
  2. **Generalize from "trailing" to "any tool_use in the fold window without a matching tool_result,"** found
     by a set-membership check over `call_id`s (as OpenHands and Codex both do), not by positional "is it the
     last block." This matters the moment coa's loop can emit parallel/batched tool calls in one turn — an
     interrupt can strand a non-last call in that batch.
  3. **Keep a drop-based fallback, but treat it as a logged anomaly path, not the primary mechanism** —
     mirrors OpenHands's two-tier design (tier 1: synthesize as close to the failure as possible; tier 2:
     `ToolCallMatchingProperty`-style drop, at fold time, only for whatever slipped past tier 1, with a warning
     log). This gives coa the same defense-in-depth without making "drop" the thing a normal interrupt path
     relies on.
  4. **If/when coa's fold needs more than one invariant** (tool-call pairing today; batch atomicity and
     thinking-block-loop atomicity are realistic "later" additions once multi-tool-call turns or extended
     thinking are exercised — §7), consider OpenHands's shape: a small ordered list of independently-testable
     "property" objects, each with an `enforce()` that reports what it would drop/repair, rather than one
     monolithic trim function. Not needed for v1 scope, but the shape scales cleanly and each property is unit-
     testable in isolation, which a single ad hoc function resists.
- **Materialization:** compute-on-demand is right; if/when fold latency matters at coa's session sizes, add an
  **in-memory** incrementally-maintained cache (OpenHands's `state.view` pattern: linear-append fast path,
  full-rebuild fallback on any anomaly/fork/resume) rather than a second persisted store. This preserves ADR
  0010's "single durable substrate" invariant while still being fast.
- **Streaming deltas:** keep them entirely out of the durable log, exactly as planned — this is unanimous
  across all three harnesses. Treat opencode's issue #11329 (per-delta storage writes → perceptible lag) as a
  concrete regression test to write once coa's streaming lands: assert the durable store sees zero writes
  during a stream and exactly one write at settle.

**Nothing found here contradicts ADR 0010's core direction.** The one real course-correction is narrow and
specific: change the dangling-tool-call repair from "drop the trailing call" to "synthesize a deterministic
paired result for any unmatched call, with drop as a rare, logged fallback" — and do the repair keyed by
`call_id` set membership, not list position.

---

## Sources

- OpenHands SDK — [events docs](https://docs.openhands.dev/sdk/arch/events),
  [LLM streaming guide](https://docs.openhands.dev/sdk/guides/llm-streaming),
  [event storage & replay (DeepWiki)](https://deepwiki.com/All-Hands-AI/OpenHands/12.2-event-storage-and-replay),
  [SDK paper (arXiv 2511.03690)](https://arxiv.org/html/2511.03690v1) — §4.2 event-sourcing, §4.4
  action/observation, §4.6 condenser.
  Source reads (via `gh api`, `OpenHands/software-agent-sdk`, `main`):
  `openhands-sdk/openhands/sdk/event/base.py`,
  `openhands-sdk/openhands/sdk/event/llm_convertible/action.py`,
  `openhands-sdk/openhands/sdk/event/llm_convertible/observation.py`,
  `openhands-sdk/openhands/sdk/conversation/state.py` (`get_unmatched_actions`, `active_branch`),
  `openhands-sdk/openhands/sdk/context/view/view.py` (`View`, `enforce_properties`, `append_event`,
  `from_events`),
  `openhands-sdk/openhands/sdk/context/view/properties/{__init__,tool_call_matching,batch_atomicity,
  tool_loop_atomicity,observation_uniqueness}.py`.
- opencode — [server docs](https://opencode.ai/docs/server/),
  [message & prompt system (DeepWiki 2.2)](https://deepwiki.com/sst/opencode/2.2-message-and-prompt-system),
  [provider transformations (DeepWiki 4.3)](https://deepwiki.com/sst/opencode/4.3-provider-transformations),
  [storage & migration (DeepWiki 2.8)](https://deepwiki.com/sst/opencode/2.8-storage-and-migration-system).
  Source reads (via `gh api`, `sst/opencode` → resolves to `anomalyco/opencode`, `dev`):
  `packages/opencode/src/session/message-v2.ts` (`toModelMessagesEffect`, dangling-tool-call handling ~L349–362),
  `packages/opencode/src/session/session.ts` (`updatePart`, `updatePartDelta`),
  `packages/opencode/src/sync/README.md` (Bus vs. SyncEvent, projectors).
  Filed issue: [#11329 — slow perceived response time from excessive storage writes during
  streaming](https://github.com/sst/opencode/issues/11329).
- OpenAI Codex CLI (`codex-rs`) — [app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md),
  [rollout persistence & replay (DeepWiki 3.5.2)](https://deepwiki.com/openai/codex/3.5.2-rollout-persistence-and-replay).
  Source reads (via `gh api`, `openai/codex`, `main`):
  `codex-rs/core/src/context_manager/history.rs` (`for_prompt`, `normalize_history`),
  `codex-rs/core/src/context_manager/normalize.rs` (`ensure_call_outputs_present`, `remove_orphan_outputs`,
  `synthetic_output_id`).
- Prior spike: [`2026-07-06-agent-hardening-prior-art.md`](2026-07-06-agent-hardening-prior-art.md).
- Prior decision: [ADR 0010](../../adr/0010-append-only-conversation-log.md).

---

_Research spike — not a commitment; input to the ADR 0010 execution plan (event vocabulary + fold design).
Verify load-bearing claims against the cited source before building; items marked **[unverified]** above were
not traced to a specific line of code in this session._

_Last reviewed: 2026-07-09_
