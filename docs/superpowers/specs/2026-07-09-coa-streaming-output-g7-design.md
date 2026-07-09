# Streaming output (G7 / Piece B) — spec-detail

> **Spec-detail, not a fresh design.** The design basis is
> [`2026-07-06-coa-agent-hardening-design.md`](2026-07-06-coa-agent-hardening-design.md) **§4-G7** (+ §5
> verification, §7 open questions) and
> [`2026-07-07-long-lived-session-multiturn-design.md`](2026-07-07-long-lived-session-multiturn-design.md)
> **§3 (P-γ)**. This document resolves the four forks those left open, and pins the concrete build shape against
> current code. It is the last piece of the foundations trio (C barge-in → E append-only SoT → **B streaming**),
> and it sits on E's substrate: E made conversation persistence one append-only `events.ndjson` of **settled**
> frames ([ADR 0010](../../adr/0010-append-only-conversation-log.md)); B's one hard rule is that streaming
> **deltas never enter that log**.

## 1. What B delivers

Incremental token streaming for **all backends** — the agent's text (and reasoning) appears as it is produced,
not as one `text` frame per model round-trip. coa is today the only surveyed harness without it. Concretely:

- The pure-API primitive `complete()` gains a **streaming form** — an async-iterable of text/reasoning deltas
  that **terminates in** the settled `CompletionResult`.
- The Claude SDK backend surfaces `includePartialMessages`.
- A new **delta `TurnFrame` kind** carries a chunk to the console, which appends it to the in-progress block;
  the **canonical transcript still stores only the whole settled assistant text**.
- Interrupt mid-stream **keeps and marks** the partial text (the A1 refinement — previously an in-flight
  round-trip was lost entirely on abort).

## 2. Resolved forks (maintainer, 2026-07-09)

The four open choices from §4-G7 / §7 and the handoff, decided:

1. **Delta-frame shape → a distinct `TurnFrame` kind** (not a flag on `text`). Every OSS peer models a delta as
   its own event (opencode `PartDelta`, Codex `PlanDelta`, OpenHands token side-channel — see
   [the OSS survey §6](../../design/research/2026-07-09-append-only-persistence-oss.md)), and a distinct `t`
   gives the E-seam a clean discriminated-union check instead of a fragile property read on the kind the fold
   already keys on.
2. **Reasoning streams too** (not answer-text only). Thinking is display-only and already dropped from the fold
   (E), so a reasoning delta is purely delivery — zero log impact. Two delta kinds, one per channel.
3. **Interrupt marking → append a marker to the text.** The kept partial becomes the settled `text` frame with a
   trailing `\n\n[interrupted]` (mirrors Claude Code's `[Request interrupted]`). No new fields, no new fold or
   console branch — it lands as one ordinary settled frame the fold already handles.
4. **`complete()` signature → `AsyncGenerator<CompletionDelta, CompletionResult>`.** The generator's *return*
   value is the settled result — literally "deltas terminating in the settled result." One object, type-safe; a
   non-streaming backend yields nothing and returns the result (byte-identical to today, D85).

## 3. The neutral types

**`CompletionDelta`** — new, in `packages/loop-driver/src/complete.ts`. A loop-driver-neutral shape carrying no
frame vocabulary (the driver, not the adapter, maps a delta to a `TurnFrame`):

```ts
export type CompletionDelta =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string };
```

**`CompleteFn`** becomes streaming; `CompletionResult` is **unchanged** (the return value still carries the whole
`text`, `reasoning?`, `toolCalls`, `usage`):

```ts
export type CompleteFn = (
  messages: readonly DriverMessage[],
  tools: readonly ToolDef[],
  signal?: AbortSignal,
) => AsyncGenerator<CompletionDelta, CompletionResult>;
```

**Two delta `TurnFrame` kinds** — new members of `turnFrameSchema` in `packages/shared/src/push.ts`. Delivery-only
(pushed over R-12, never appended):

```ts
z.object({ t: z.literal('text-delta'), text: z.string() }),
z.object({ t: z.literal('thinking-delta'), text: z.string() }),
```

They ride the existing `turn` Push (which already embeds `turnFrameSchema`), so no new Push kind is needed.

## 4. Data flow — pure-API (DeepSeek / LongCat via the driver)

`runGovernedLoop` (`packages/loop-driver/src/driver.ts`) drives the generator, emits a delta frame per chunk,
then runs its **existing** settled emission from the returned result:

```ts
const it = deps.complete(messages, tools, deps.signal);
let partialText = '';
let result: CompletionResult;
for (;;) {
  const next = await it.next();
  if (next.done) { result = next.value; break; }
  const d = next.value;
  if (d.kind === 'text') { partialText += d.text; emit({ t: 'text-delta', text: d.text }); }
  else emit({ t: 'thinking-delta', text: d.text });
}
addUsage(usage, result.usage);
// ↓ unchanged from today: settled `thinking` frame, settled `text` frame, push assistant message, tool loop …
```

The settled `thinking`/`text` frames and the assistant-message push are **untouched** — the fold and cross-turn
memory are unaffected. The adapters (`packages/adapter-deepseek/src/complete.ts`,
`packages/adapter-longcat/src/complete.ts`) flip `stream: true`, parse the SSE stream into `content` /
`reasoning_content` deltas (yielding each while accumulating), and `return` the assembled `CompletionResult`
(text + reasoning + tool calls + usage) at `[DONE]`.

**D85 degrade:** a non-streaming adapter implements `complete()` by yielding nothing and returning the result;
the driver emits only the settled frames — byte-identical to today.

## 5. Data flow — Claude SDK (direct, no driver)

The SDK adapter (`packages/adapter-claude-sdk/src/claude-sdk-adapter.ts`) drives `query()` itself. B adds
`includePartialMessages: true` to the assembled options. The existing `for await (message of sdkQuery)` loop now
also receives `stream_event` messages; `messageToFrames` (`turn-frames.ts`) gains a `stream_event` case mapping a
`content_block_delta` (`text_delta` → `text-delta`, `thinking_delta` → `thinking-delta`) to the **same two
neutral delta frames**. The settled assistant message still yields the settled `text`/`thinking` frames exactly as
now. So the console sees deltas-then-settled on both backend families, and no provider streaming type crosses the
M8 seam (ADR 0002/0004 neutral seam).

## 6. The load-bearing E-seam (`packages/core/src/session/session-handlers.ts`)

Both `record(frame, full?)` closures (`runPerTurn` ~L415 and `establishHeldQuery` ~L586) push **and** append every
frame today. B adds one guard at the top of each:

```ts
if (frame.t === 'text-delta' || frame.t === 'thinking-delta') {
  session.emit({ kind: 'turn', sessionId: started.id, worktree: started.worktree, seq: s, frame });
  return; // delivery-only: pushed over R-12, NEVER store.append-ed
}
```

Delta frames reach the wire but never the durable log. The settled `text` frame appends exactly as today, so the
read-time fold (`foldEventsToTranscript`) sees only settled frames and **cross-turn memory is unchanged**. This is
the entire B↔E contract; get the split right and the substrate stays correct for free.

> **Note on `seq`.** A delta frame consumes a `seq` for its live push (as every emitted frame does) but is not
> persisted, so the persisted `seq` sequence has gaps where deltas were pushed. That is fine: `seq` is a
> monotonic push-ordering cursor, and reload projects only persisted events — it never assumes a contiguous
> `seq`. (Confirm no consumer treats reloaded `seq` as dense during the plan.)

## 7. Interrupt mid-stream (A1 refinement)

B is where partial-text retention finally lands (A2 explicitly deferred it here). Today the abort check sits at
the **loop top, before `complete()`**, so an in-flight round-trip is simply lost. Now the driver can be aborted
**inside** the generator (the `signal` is already forwarded to `complete()` → the adapter's `fetch`/SSE read). Its
`catch` keeps the accumulated `partialText`, emits it as **one settled `text` frame** with a `\n\n[interrupted]`
marker, then settles:

```ts
} catch (err) {
  if (deps.signal?.aborted) {
    if (partialText !== '') emit({ t: 'text', text: `${partialText}\n\n[interrupted]` });
    break; // settle in the existing finally; interrupted-status suppression (SC-1) unchanged
  }
  throw err;
}
```

`record` appends that one settled frame → the log (and thus memory) has the partial. No deltas are appended. The
`interrupted` status is still emitted by `interruptSession` and suppressed from rendering as an error (SC-1,
unchanged).

**SDK partial-on-interrupt is a real-SDK unknown.** Whether the SDK emits a settled assistant block on interrupt
or only deltas + `error_during_execution` + `turn-boundary` (piece C's live-established window) determines whether
the SDK adapter must **synthesize** the marked settled `text` frame from accumulated deltas. Fakes model the shape
of streaming but not the SDK's real partial emission, so this is **characterized and locked by the `COA_LIVE`
smoke** and the code adapts to what is observed — exactly how C and E resolved their live unknowns. The invariant
holds under either outcome: on interrupt the partial (if any) lands as **one** settled `text` frame and deltas are
never persisted.

## 8. Console (`packages/console-viewmodel` + `apps/desktop`)

`pushToViewFrames` (`console-viewmodel/src/turn-map.ts`) maps `text-delta`/`thinking-delta` to a view concept; the
`ChatPanel` appends them into a **live streaming block** for the active turn, and when the settled `text`/
`thinking` frame arrives it **replaces** that block (no double-render). Because the settled text equals the
accumulated deltas, the swap is visually seamless (opencode's `PartDelta` → `PartUpdated` model).
`reloadToViewFrames` never sees deltas (they aren't persisted), so a reopened session is unchanged, and `coa raw`
degrades cleanly to the settled floor (D85).

**Reconciliation is positional in v1** (no per-block delta IDs): the current streaming block of a channel is
replaced by the next settled block of that channel. This holds because there is exactly one streaming text block
and one streaming thinking block per round-trip — text precedes tool calls within a round-trip on the pure-API
path, and an SDK assistant message closes each streamed block with its settled counterpart.

## 9. Scope discipline (out)

- **Tool-call *input* streaming** — only text and reasoning stream; a tool call still arrives whole. (The SDK
  streams `input_json_delta`; B ignores it.)
- **Per-block delta IDs / index correlation** — positional reconciliation only (§8).
- **Mid-stream reconnect resuming a partial** — a reconnecting viewer rejoins the live channel or sees the last
  settled block; coa never persists partial text (the opencode #11329 lesson, §10).

## 10. Invariants (must not regress)

- **E's substrate (the #1 rule):** deltas ephemeral (push-only), settled frames persisted. Executable form,
  straight from opencode issue #11329: during a stream the durable store sees **zero** `append`s and **exactly
  one** at settle.
- **D85:** a non-streaming adapter degrades to the settled frame (§4); a one-turn conversation's settled
  transcript is byte-identical (the fold sees only settled frames); `coa raw` still works and streaming degrades
  cleanly.
- **SC-1:** streaming and interrupt are user-facing, never a block or an error; the only two blocks remain the M3
  close-gate and the M7 cost-cap.
- **A1 block-preserving:** interrupt keeps + marks the partial; the partial still lands as **one** settled `text`
  frame in the log.
- **Neutral seam (ADR 0002/0004):** no backend streaming type crosses M8; `CompletionDelta` is loop-driver-
  neutral; the delta `TurnFrame` is M0-neutral; composition never branches on backend.

## 11. Verification

- **Units** — the streaming `complete()` shape yields deltas terminating in the settled result; a non-streaming
  adapter degrades to one settled frame; the driver emits delta frames then the settled frames; the E-seam pushes
  a delta but does **not** append it (the zero-writes-during-stream regression test); interrupt mid-stream keeps +
  marks the partial as one settled `text` frame; the console appends deltas then reconciles on the settled frame.
- **Live smoke (`COA_LIVE`-gated, authoritative)** — a 4th `*.live.test.ts` in `packages/adapter-claude-sdk/src/`
  (resolving the active `personal` account from `~/.coa/accounts.yaml`, mirroring the streaming/barge-in/sot
  smokes): the Claude SDK really emits partial-message deltas under `includePartialMessages`, and interrupt
  mid-stream captures the partial. This pass also **extracts the shared `live-smoke-helpers.ts`** the E review
  flagged (the four smokes duplicate `createPushQueue`/`waitForCondition`/`resolveLiveLocator`).
- **Same-commit docs** — a new **ADR 0013** ("the streaming `complete()` contract + delta frames are
  delivery-only"), reachable from `docs/adr/README.md`; `docs/design/handoff/spec/M8.md` (emit policy) +
  `spec/M9.md` (adapters / `complete()`) + `ROADMAP.md`, each in the commit that changes the code it describes.
  Keep `pnpm docs:check` green (modulo the maintainer's untracked `project.md`, an external failure — never
  touch it).

---

_Last reviewed: 2026-07-09_
