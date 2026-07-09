# Streaming output (G7 / Piece B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incremental token streaming for all backends — the agent's text and reasoning appear as produced, delivered as ephemeral delta frames that never enter the append-only durable log.

**Architecture:** Give the pure-API `complete()` primitive a streaming form (`AsyncGenerator<CompletionDelta, CompletionResult>`); the governed loop driver emits a delta `TurnFrame` per chunk, then its existing settled emission from the generator's return value (unchanged). The Claude SDK backend surfaces `includePartialMessages` and maps `stream_event` messages to the same neutral delta frames. Two new delta `TurnFrame` kinds are delivery-only: pushed over R-12, never `store.append`-ed (the E-substrate contract). Interrupt mid-stream keeps + marks the partial as one settled `text` frame.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Zod, Vitest, `@anthropic-ai/claude-agent-sdk`, OpenAI-compatible SSE (DeepSeek/LongCat).

## Global Constraints

- **TypeScript `strict`, no `any`.** `exactOptionalPropertyTypes` is ON — optional fields via guarded spreads (`...(x !== undefined ? { x } : {})`), never `x: undefined`.
- **RUN TYPECHECK, not just eslint+vitest** — `pnpm --filter <pkg> typecheck`. Vitest transpiles without full typechecking.
- **Green per commit** — every task ends with the touched packages' tests + typecheck passing. Some packages lack a `test` script — use `pnpm vitest run <path>`.
- **E's substrate (the #1 rule):** streaming deltas are delivery-only — pushed, NEVER `store.append`-ed. Only settled frames enter `events.ndjson`.
- **D85:** a non-streaming adapter degrades to the settled frame; a one-turn conversation's settled transcript is byte-identical; `coa raw` still works.
- **SC-1:** streaming/interrupt are user-facing, never a block or an error; the only two blocks are the M3 close-gate + M7 cost-cap.
- **A1 block-preserving:** interrupt keeps + marks the partial; it still lands as ONE settled `text` frame in the log.
- **Neutral seam (ADR 0002/0004):** no backend streaming type crosses M8; `CompletionDelta` is loop-driver-neutral; the delta `TurnFrame` is M0-neutral; composition never branches on backend.
- **Commits:** subject-only Conventional Commits — no body, no `Co-Authored-By`/trailer, no phase/plan/module IDs in the subject. Stage files BY NAME; never `git add -A`.
- **NEVER stage/edit** `DEV-NOTES.md`; never stage `TEMP.txt`, `project.md`, or `docs/superpowers/plans/2026-07-08-sdk-streaming-input-steering.md` (maintainer's).
- **Same-commit doc rule:** a code change updates the owning SPEC module (`docs/design/handoff/spec/M8.md` and/or `M9.md`) + `ROADMAP.md` in the same commit; the new durable decision gets **ADR 0013**, reachable from `docs/adr/README.md`. `pnpm docs:check` currently fails ONLY on the maintainer's untracked `project.md` — that is EXTERNAL; never "fix" it.
- **Design basis:** [`docs/superpowers/specs/2026-07-09-coa-streaming-output-g7-design.md`](../specs/2026-07-09-coa-streaming-output-g7-design.md). VERIFY against current code, never against this plan or memory.

---

## File Structure

- `packages/shared/src/push.ts` — add two delta kinds to `turnFrameSchema` (Task 1).
- `packages/loop-driver/src/complete.ts` — add `CompletionDelta`; make `CompleteFn` a streaming generator (Task 2).
- `packages/loop-driver/src/driver.ts` — iterate the generator, emit delta frames, then settled (Task 2); interrupt-partial retention (Task 5).
- `packages/adapter-deepseek/src/complete.ts`, `packages/adapter-longcat/src/complete.ts` — generator form (Task 2), then real SSE streaming (Task 4).
- `packages/core/src/session/session-handlers.ts` — the E-seam: delta frames push-but-not-append (Task 3).
- `packages/adapter-claude-sdk/src/turn-frames.ts` — map `stream_event` → delta frames (Task 6).
- `packages/adapter-claude-sdk/src/session-options.ts` — `includePartialMessages: true` (Task 6).
- `packages/console-viewmodel/src/turn-map.ts`, `apps/desktop` `ChatPanel` — live streaming block + reconcile (Task 7).
- `packages/adapter-claude-sdk/src/streaming-output-smoke.live.test.ts` + `live-smoke-helpers.ts` — live gate (Task 8).

---

## Task 1: Delta frames on the wire (additive)

**Files:**
- Modify: `packages/shared/src/push.ts` (add to `turnFrameSchema`, the discriminated union at lines 11-46)
- Test: `packages/shared/src/push.test.ts` (create if absent; otherwise add cases)

**Interfaces:**
- Produces: two `TurnFrame` members — `{ t: 'text-delta', text: string }` and `{ t: 'thinking-delta', text: string }`. Consumed by the driver (Task 2), the E-seam (Task 3), the SDK mapper (Task 6), and the console (Task 7).

- [ ] **Step 1: Write the failing test**

Create/extend `packages/shared/src/push.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { turnFrameSchema } from './push.js';

describe('turnFrameSchema delta kinds', () => {
  it('accepts a text-delta frame', () => {
    const parsed = turnFrameSchema.parse({ t: 'text-delta', text: 'hel' });
    expect(parsed).toEqual({ t: 'text-delta', text: 'hel' });
  });

  it('accepts a thinking-delta frame', () => {
    const parsed = turnFrameSchema.parse({ t: 'thinking-delta', text: 'ponder' });
    expect(parsed).toEqual({ t: 'thinking-delta', text: 'ponder' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/src/push.test.ts`
Expected: FAIL — the discriminated union rejects the unknown `t` values.

- [ ] **Step 3: Add the two members**

In `packages/shared/src/push.ts`, inside the `turnFrameSchema` discriminated union (after the `thinking` member near line 12, keep the delta kinds adjacent to their settled siblings for readability):

```ts
  z.object({ t: z.literal('thinking'), text: z.string() }),
  // Delivery-only streaming deltas (Piece B / G7): pushed over R-12 for live render,
  // NEVER store.append-ed — the durable log holds only settled frames (docs/adr/0010,
  // docs/adr/0013). The console appends a delta to the in-progress block; the settled
  // `text`/`thinking` frame that follows is the canonical record.
  z.object({ t: z.literal('text-delta'), text: z.string() }),
  z.object({ t: z.literal('thinking-delta'), text: z.string() }),
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run packages/shared/src/push.test.ts && pnpm --filter @coa/shared typecheck`
Expected: PASS, typecheck exit 0.

- [ ] **Step 5: Confirm no consumer broke on the wider union**

Run: `pnpm --filter @coa/console-viewmodel typecheck && pnpm --filter @coa/core typecheck`
Expected: exit 0 (existing `switch (frame.t)` sites have a `default`, so a wider union is safe).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/push.ts packages/shared/src/push.test.ts
git commit -m "feat: add streaming delta frame kinds to the turn union"
```

---

## Task 2: Streaming `complete()` signature + driver delta emission (D85 degrade baseline)

Flip the primitive to a generator and have the driver emit deltas, but keep the pure-API adapters **non-streaming** (yield nothing, return the whole result) — a pure refactor with byte-identical runtime behavior for the real adapters. Real SSE lands in Task 4. This also introduces **ADR 0013** (the durable contract).

**Files:**
- Modify: `packages/loop-driver/src/complete.ts` (add `CompletionDelta`; change `CompleteFn`)
- Modify: `packages/loop-driver/src/driver.ts:139-146` (consume the generator; emit deltas)
- Modify: `packages/adapter-deepseek/src/complete.ts:60-93`, `packages/adapter-longcat/src/complete.ts:56-89` (wrap the existing body in `async function*` returning the result)
- Modify: every fake `complete` in `packages/loop-driver/src/*.test.ts`, `packages/core/src/session/*.test.ts`, `packages/adapter-deepseek/src/*.test.ts`, `packages/adapter-longcat/src/*.test.ts` (mechanical: `async () => result` → `async function* () { return result; }`)
- Create: `docs/adr/0013-streaming-complete-and-delta-frames.md`; Modify: `docs/adr/README.md`
- Test: `packages/loop-driver/src/driver.test.ts` (new streaming case)

**Interfaces:**
- Produces:
  ```ts
  export type CompletionDelta =
    | { kind: 'text'; text: string }
    | { kind: 'reasoning'; text: string };
  export type CompleteFn = (
    messages: readonly DriverMessage[],
    tools: readonly ToolDef[],
    signal?: AbortSignal,
  ) => AsyncGenerator<CompletionDelta, CompletionResult>;
  ```
- Consumes: `CompletionResult` (unchanged — still the whole `text`, `reasoning?`, `toolCalls`, `usage`), the `TurnFrame` delta kinds from Task 1.

- [ ] **Step 1: Write the failing driver test**

Add to `packages/loop-driver/src/driver.test.ts` (match the file's existing harness/imports; this shows the assertion shape — reuse the file's `catalogue`, `canUseTool`, `gate` fixtures):

```ts
it('emits text-delta and thinking-delta frames as the generator yields, then the settled frames', async () => {
  const frames: TurnFrame[] = [];
  // eslint-disable-next-line @typescript-eslint/require-await
  async function* streamingComplete(): AsyncGenerator<CompletionDelta, CompletionResult> {
    yield { kind: 'reasoning', text: 'th' };
    yield { kind: 'reasoning', text: 'ink' };
    yield { kind: 'text', text: 'Hel' };
    yield { kind: 'text', text: 'lo' };
    return { text: 'Hello', reasoning: 'think', toolCalls: [], usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 } };
  }
  await runGovernedLoop({
    sessionId: 's', complete: streamingComplete, catalogue: [], systemPrompt: '', input: 'hi',
    canUseTool: async () => ({ behavior: 'allow' }) as never,
    gate: async () => ({ allow: true }),
    onTurn: (f) => frames.push(f),
  });
  // deltas arrive in order, then the settled thinking + settled text
  expect(frames).toEqual([
    { t: 'thinking-delta', text: 'th' },
    { t: 'thinking-delta', text: 'ink' },
    { t: 'text-delta', text: 'Hel' },
    { t: 'text-delta', text: 'lo' },
    { t: 'thinking', text: 'think' },
    { t: 'text', text: 'Hello' },
  ]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/loop-driver/src/driver.test.ts -t "emits text-delta"`
Expected: FAIL — the type won't compile (`complete` is `Promise`-returning) and no delta frames are emitted.

- [ ] **Step 3: Add `CompletionDelta` and change `CompleteFn`**

In `packages/loop-driver/src/complete.ts`, add after `CompletionResult` (keep its doc comment) :

```ts
/**
 * One streaming chunk from a model round-trip (Piece B / G7): an incremental piece of
 * answer `text` or of the reasoning ("thinking") channel. Neutral — the driver maps a
 * delta to a `text-delta`/`thinking-delta` TurnFrame; no frame vocabulary crosses this
 * seam. Delivery-only: deltas are pushed to the UI, never persisted (docs/adr/0013).
 */
export type CompletionDelta =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string };
```

Replace the `CompleteFn` type:

```ts
/**
 * The streaming `complete()` primitive: one model round-trip as an async-iterable of
 * text/reasoning deltas TERMINATING IN the settled {@link CompletionResult} (the
 * generator's return value). A non-streaming backend degrades to yielding nothing and
 * returning the whole result — byte-identical to a single-block turn (D85).
 */
export type CompleteFn = (
  messages: readonly DriverMessage[],
  tools: readonly ToolDef[],
  signal?: AbortSignal,
) => AsyncGenerator<CompletionDelta, CompletionResult>;
```

- [ ] **Step 4: Consume the generator in the driver**

In `packages/loop-driver/src/driver.ts`, replace the block at lines 139-146 (`const result = await deps.complete(...)` through the settled `text` emit). Import `CompletionDelta` from `./complete.js` if needed (it is referenced only structurally; import not strictly required). New block:

```ts
      // Drive the streaming round-trip: emit each delta live, then settle from the
      // generator's return value. Delta frames are delivery-only (docs/adr/0013) —
      // M8's record policy pushes but never persists them.
      const it = deps.complete(messages, tools, deps.signal);
      let step = await it.next();
      while (step.done !== true) {
        const delta = step.value;
        if (delta.kind === 'text') emit({ t: 'text-delta', text: delta.text });
        else emit({ t: 'thinking-delta', text: delta.text });
        step = await it.next();
      }
      const result = step.value;
      addUsage(usage, result.usage);
      // Reasoning precedes the answer (pre-answer thinking). Display-only: emitted as a
      // thinking frame but never pushed into `messages` — the API rejects reasoning on input.
      if (result.reasoning !== undefined && result.reasoning !== '') {
        emit({ t: 'thinking', text: result.reasoning });
      }
      if (result.text !== '') emit({ t: 'text', text: result.text });
```

(The `addUsage`/`messages.push` lines that followed the old settled-text emit stay as they are.)

- [ ] **Step 5: Convert the pure-API adapters to non-streaming generators**

In `packages/adapter-deepseek/src/complete.ts`, change the returned closure (line 60) from `return async (messages, tools, signal) => { ... return { ... }; };` to a generator that keeps the identical body but `return`s the result and yields nothing:

```ts
  // Non-streaming form (Piece B baseline): one round-trip, yield nothing, return the
  // whole result — the D85 degrade. Real SSE streaming is layered on in a later step.
  return async function* (messages, tools, signal) {
    const body = { /* unchanged */ };
    const res = await doFetch(`${baseUrl}/chat/completions`, { /* unchanged */ });
    if (!res.ok) throw new Error(`deepseek chat/completions failed: ${res.status} ${await res.text()}`);
    const parsed = chatCompletionResponseSchema.parse(await res.json());
    const choice = parsed.choices[0]!;
    return {
      text: choice.message.content ?? '',
      reasoning: choice.message.reasoning_content ?? undefined,
      toolCalls: (choice.message.tool_calls ?? []).map((call) => ({
        id: call.id, name: call.function.name, arguments: parseArguments(call.function.arguments),
      })),
      usage: toRuntimeUsage(parsed.usage, config.model, prices),
    };
  };
```

Apply the identical transform to `packages/adapter-longcat/src/complete.ts` (its error string says `longcat`).

- [ ] **Step 6: Fix every fake `complete` flagged by typecheck**

Run: `pnpm --filter @coa/loop-driver typecheck` — it lists each test fake that no longer conforms. Convert each with the mechanical pattern:

```ts
// before:  const complete: CompleteFn = async () => ({ text: 'x', toolCalls: [], usage });
// after:
const complete: CompleteFn = async function* () {
  return { text: 'x', toolCalls: [], usage };
};
```

Repeat `typecheck` for `@coa/core`, `@coa/adapter-deepseek`, `@coa/adapter-longcat` and fix each fake the same way until all exit 0.

- [ ] **Step 7: Run the driver test + full suites**

Run: `pnpm vitest run packages/loop-driver/src/driver.test.ts && pnpm --filter @coa/loop-driver test && pnpm --filter @coa/core test && pnpm --filter @coa/adapter-deepseek test && pnpm --filter @coa/adapter-longcat test`
Expected: PASS. (The new streaming test passes; every pre-existing test still green — runtime behavior for the real adapters is byte-identical since they yield nothing.)

- [ ] **Step 8: Write ADR 0013**

Create `docs/adr/0013-streaming-complete-and-delta-frames.md` (match the format of `docs/adr/0012-*.md` — Status/Context/Decision/Consequences). Content:

```markdown
# 13. Streaming complete() contract and delivery-only delta frames

Date: 2026-07-09

## Status

Accepted

## Context

coa was the only surveyed harness rendering one text block per model round-trip. G7
(Piece B) adds incremental token streaming for all backends. The append-only log
(ADR 0010) stores only settled frames; the OSS survey
(docs/design/research/2026-07-09-append-only-persistence-oss.md §6) found every peer
keeps streaming deltas out of its durable store, and opencode filed a regression
(#11329) from persisting every delta.

## Decision

- The pure-API `complete()` primitive is an `AsyncGenerator<CompletionDelta,
  CompletionResult>`: it yields text/reasoning deltas and RETURNS the settled result.
  A non-streaming backend yields nothing and returns the whole result (D85 degrade).
- A streaming chunk reaches the UI as a distinct TurnFrame kind (`text-delta` /
  `thinking-delta`), never a flag on `text`.
- Delta frames are DELIVERY-ONLY: pushed over R-12, never `store.append`-ed. The
  settled `text`/`thinking` frame remains the sole durable record, so the read-time
  fold and cross-turn memory are unchanged.
- Interrupt mid-stream keeps the accumulated partial and marks it (`\n\n[interrupted]`),
  emitting it as ONE settled `text` frame (A1).

## Consequences

- The E substrate stays correct by construction: the durable store sees zero appends
  during a stream and exactly one at settle.
- The Claude SDK backend surfaces `includePartialMessages`, mapping partial messages to
  the same neutral delta frames — no backend streaming type crosses the M8 seam.
- Reconciliation is positional in v1 (no per-block delta ids); a settled block replaces
  the live-streamed block of its channel.
```

Add the row to `docs/adr/README.md` (mirror the 0012 line).

- [ ] **Step 9: Verify docs + commit**

Run: `pnpm docs:check` (expect the ONLY failure to be the maintainer's `project.md`; 0013 must be reachable).

```bash
git add packages/loop-driver/src/complete.ts packages/loop-driver/src/driver.ts \
  packages/loop-driver/src/driver.test.ts packages/adapter-deepseek/src/complete.ts \
  packages/adapter-longcat/src/complete.ts docs/adr/0013-streaming-complete-and-delta-frames.md \
  docs/adr/README.md
# also stage every test file you edited in Step 6, by name
git commit -m "feat: make the completion primitive stream deltas terminating in the settled result"
```

---

## Task 3: The E-seam — deltas are delivery-only

Make M8's `record` policy push a delta frame but never persist it. This is the load-bearing B↔E contract.

**Files:**
- Modify: `packages/core/src/session/session-handlers.ts` — the `record` closure in `runPerTurn` (~L415) and in `establishHeldQuery` (~L586)
- Test: `packages/core/src/session/session-handlers.test.ts` (or the file that exercises `record`/persistence — grep for `store.append` usage in the session tests)

**Interfaces:**
- Consumes: the `text-delta`/`thinking-delta` frame kinds (Task 1).

- [ ] **Step 1: Write the failing test (the #11329 regression)**

Add a test asserting a delta frame is pushed to the connection but NOT appended to the store, while a settled `text` frame is both. Use the file's existing harness for driving a session with a fake adapter whose `onTurn` emits frames; capture `store.append` calls (spy/fake store) and `session.emit`/connection push. Assertion shape:

```ts
it('pushes a text-delta frame but never appends it to the durable log', async () => {
  // drive a turn whose adapter emits: text-delta 'Hel', text-delta 'lo', settled text 'Hello'
  // (script the fake adapter's onTurn accordingly)
  await runOneTurn(/* ... */);

  const appended = fakeStore.appendedFrames();        // helper: flattens every store.append payload's frame
  const pushed = connection.pushedTurnFrames();        // helper: frames from every {kind:'turn'} push

  expect(pushed).toContainEqual({ t: 'text-delta', text: 'Hel' });
  expect(pushed).toContainEqual({ t: 'text', text: 'Hello' });
  expect(appended).not.toContainEqual({ t: 'text-delta', text: 'Hel' });
  expect(appended).not.toContainEqual({ t: 'thinking-delta', text: expect.anything() });
  expect(appended).toContainEqual({ t: 'text', text: 'Hello' }); // settled frame IS persisted
});
```

(If the existing test file lacks these helpers, add small local ones over the fake store and fake connection already used there.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/session/session-handlers.test.ts -t "never appends"`
Expected: FAIL — the delta frame is currently appended.

- [ ] **Step 3: Add the guard to both `record` closures**

In `runPerTurn`'s `record` (after the `if (started === undefined) return;` line, before computing `s`):

```ts
    const record = (frame: TurnFrame, full?: string): void => {
      if (started === undefined) return;
      // Streaming deltas are delivery-only (docs/adr/0013): push for live render, but
      // NEVER persist — the append-only log (docs/adr/0010) holds only settled frames,
      // so the read-time fold and cross-turn memory are unchanged.
      if (frame.t === 'text-delta' || frame.t === 'thinking-delta') {
        const s = seqBox.value++;
        session.emit({ kind: 'turn', sessionId: started.id, worktree: started.worktree, seq: s, frame });
        return;
      }
      const s = seqBox.value++;
      session.emit({ kind: 'turn', sessionId: started.id, worktree: started.worktree, seq: s, frame });
      if (prep.persistIn !== undefined) {
        prep.persistIn.store.append(prep.persistIn.convId, [
          { seq: s, frame, ...(full !== undefined ? { full } : {}) },
        ]);
      }
    };
```

Apply the same guard in `establishHeldQuery`'s `record` (mind its extra `frame.t === 'error' && query.barging > 0` and `turn-boundary` branches — insert the delta guard immediately after the `if (started === undefined) return;` line, before the barging check, so a delta never touches the barging/boundary accounting):

```ts
    const record = (frame: TurnFrame, full?: string): void => {
      const started = startedRef.current;
      if (started === undefined) return;
      if (frame.t === 'text-delta' || frame.t === 'thinking-delta') {
        const s = seqBox.value++;
        session.emit({ kind: 'turn', sessionId: started.id, worktree: started.worktree, seq: s, frame });
        return;
      }
      // ...existing barging/emit/append/turn-boundary body unchanged...
    };
```

- [ ] **Step 4: Run the test + suite + typecheck**

Run: `pnpm vitest run packages/core/src/session/session-handlers.test.ts && pnpm --filter @coa/core test && pnpm --filter @coa/core typecheck`
Expected: PASS, exit 0.

- [ ] **Step 5: Same-commit doc — M8 emit policy**

In `docs/design/handoff/spec/M8.md`, in the emission-policy section, add one line: streaming delta frames (`text-delta`/`thinking-delta`) are pushed over R-12 but never appended to the event log; only settled frames persist (docs/adr/0013). Keep it a single sentence (no code).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session/session-handlers.ts \
  packages/core/src/session/session-handlers.test.ts docs/design/handoff/spec/M8.md
git commit -m "feat: push streaming deltas without persisting them to the event log"
```

---

## Task 4: Pure-API SSE streaming (DeepSeek + LongCat)

Replace the non-streaming generator body with a real SSE stream: `stream: true`, parse `data:` events, yield content/reasoning deltas while accumulating, return the assembled result.

**Files:**
- Create: `packages/adapter-deepseek/src/sse.ts` (shared SSE line parser) — or place it in each adapter if the workspace forbids cross-package import; DeepSeek and LongCat are separate packages, so **create it in each** (`packages/adapter-deepseek/src/sse.ts` and `packages/adapter-longcat/src/sse.ts`) to avoid a new dependency edge.
- Modify: `packages/adapter-deepseek/src/complete.ts`, `packages/adapter-longcat/src/complete.ts` (the generator body; extend `FetchLike` return with `body`)
- Test: `packages/adapter-deepseek/src/complete.test.ts`, `packages/adapter-longcat/src/complete.test.ts`

**Interfaces:**
- Consumes: `CompletionDelta` (Task 2).
- Produces: `parseSseChunks(body: AsyncIterable<Uint8Array>): AsyncGenerator<unknown>` — yields each parsed `data:` JSON object, stops at `[DONE]`.

- [ ] **Step 1: Write the failing SSE-parser + streaming test**

In `packages/adapter-deepseek/src/complete.test.ts`, add a fake fetch whose response `body` is an async-iterable of `Uint8Array` SSE chunks, and assert `complete()` yields the deltas in order and returns the assembled result:

```ts
function sseBody(...events: string[]): AsyncIterable<Uint8Array> {
  const enc = new TextEncoder();
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield enc.encode(e); } };
}

it('streams content and reasoning deltas, returning the assembled result', async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: true, status: 200, text: async () => '', json: async () => ({}),
    body: sseBody(
      'data: {"choices":[{"delta":{"reasoning_content":"th"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ),
  });
  const complete = makeDeepSeekComplete({ apiKey: 'k', model: 'deepseek-chat', fetchImpl, prices: {} });
  const deltas: CompletionDelta[] = [];
  const it = complete([{ role: 'user', content: 'hi' }], [], undefined);
  let step = await it.next();
  while (step.done !== true) { deltas.push(step.value); step = await it.next(); }
  expect(deltas).toEqual([
    { kind: 'reasoning', text: 'th' },
    { kind: 'text', text: 'Hel' },
    { kind: 'text', text: 'lo' },
  ]);
  expect(step.value.text).toBe('Hello');
  expect(step.value.reasoning).toBe('th');
});
```

Add a second test for a **streamed tool call** (fragmented arguments) asserting the returned `toolCalls` reassemble:

```ts
it('reassembles a streamed tool call from argument fragments', async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: true, status: 200, text: async () => '', json: async () => ({}),
    body: sseBody(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"Read","arguments":"{\\"pa"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ),
  });
  const complete = makeDeepSeekComplete({ apiKey: 'k', model: 'm', fetchImpl, prices: {} });
  const it = complete([{ role: 'user', content: 'hi' }], [], undefined);
  let step = await it.next(); while (step.done !== true) step = await it.next();
  expect(step.value.toolCalls).toEqual([{ id: 'c1', name: 'Read', arguments: { path: 'a' } }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/adapter-deepseek/src/complete.test.ts -t "streams content"`
Expected: FAIL — no deltas yielded (still non-streaming) and `res.body` unused.

- [ ] **Step 3: Add the SSE parser**

Create `packages/adapter-deepseek/src/sse.ts`:

```ts
/**
 * A minimal SSE reader for the OpenAI-compatible streaming chat API: consumes the
 * response body byte stream, buffers across chunk boundaries, and yields each `data:`
 * payload's parsed JSON, stopping at the `[DONE]` sentinel. Malformed JSON in one event
 * is skipped (degrade, not throw) — a partial line never poisons the stream.
 */
export async function* parseSseChunks(body: AsyncIterable<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = event.split('\n').find((l) => l.startsWith('data:'));
      if (dataLine === undefined) continue;
      const data = dataLine.slice(5).trim();
      if (data === '[DONE]') return;
      if (data === '') continue;
      try {
        yield JSON.parse(data);
      } catch {
        /* skip a malformed event */
      }
    }
  }
}
```

- [ ] **Step 4: Rewrite the generator body to stream**

In `packages/adapter-deepseek/src/complete.ts`: extend `FetchLike`'s return type with `body?: AsyncIterable<Uint8Array> | null` (backward-compatible — existing fakes omit it). Add `stream: true, stream_options: { include_usage: true }` to `body`. Replace the generator body:

```ts
  return async function* (messages, tools, signal) {
    const body = {
      model: config.model,
      messages: messages.map(toWireMessage),
      ...(tools.length > 0 ? { tools: tools.map(toWireTool) } : {}),
      ...reasoningBody(config.reasoning),
      stream: true,
      stream_options: { include_usage: true },
    };
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`deepseek chat/completions failed: ${res.status} ${await res.text()}`);
    if (res.body == null) throw new Error('deepseek: streaming response had no body');

    let text = '';
    let reasoning = '';
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let usage: WireUsage | undefined;

    for await (const raw of parseSseChunks(res.body)) {
      const chunk = streamChunkSchema.safeParse(raw);
      if (!chunk.success) continue;
      const choice = chunk.data.choices[0];
      const delta = choice?.delta;
      if (delta?.content != null && delta.content !== '') {
        text += delta.content;
        yield { kind: 'text', text: delta.content };
      }
      if (delta?.reasoning_content != null && delta.reasoning_content !== '') {
        reasoning += delta.reasoning_content;
        yield { kind: 'reasoning', text: delta.reasoning_content };
      }
      for (const tc of delta?.tool_calls ?? []) {
        const acc = toolAcc.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id != null) acc.id = tc.id;
        if (tc.function?.name != null) acc.name = tc.function.name;
        if (tc.function?.arguments != null) acc.args += tc.function.arguments;
        toolAcc.set(tc.index, acc);
      }
      if (chunk.data.usage != null) usage = chunk.data.usage;
    }

    return {
      text,
      reasoning: reasoning !== '' ? reasoning : undefined,
      toolCalls: [...toolAcc.values()].map((t) => ({
        id: t.id, name: t.name, arguments: parseArguments(t.args),
      })),
      usage: toRuntimeUsage(usage, config.model, prices),
    };
  };
```

Add the streaming-chunk schema to `packages/adapter-deepseek/src/wire.ts`:

```ts
/** One OpenAI-compatible streaming chunk (`chat.completion.chunk`): a partial `delta`. */
export const streamDeltaSchema = z.object({
  content: z.string().nullable().optional(),
  reasoning_content: z.string().nullable().optional(),
  tool_calls: z.array(z.object({
    index: z.number(),
    id: z.string().optional(),
    function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
  })).optional(),
});
export const streamChunkSchema = z.object({
  choices: z.array(z.object({ delta: streamDeltaSchema.optional() })),
  usage: wireUsageSchema.optional(),
});
```

Import `streamChunkSchema`, `WireUsage`, and `parseSseChunks` at the top of `complete.ts`.

> Note: `toRuntimeUsage` must tolerate `undefined` usage (a stream may omit it). Verify its signature in `pricing.ts`; if it requires a `WireUsage`, add an `undefined` guard returning the zero-usage floor — do this as part of this step and keep it a one-liner.

- [ ] **Step 5: Mirror into LongCat**

Apply the identical change to `packages/adapter-longcat/src/complete.ts` (create `packages/adapter-longcat/src/sse.ts` with the same parser; add the same `streamChunkSchema` to the LongCat `wire.ts`; error string says `longcat`). Add the mirrored tests to `packages/adapter-longcat/src/complete.test.ts`.

- [ ] **Step 6: Run tests + typecheck for both adapters**

Run: `pnpm --filter @coa/adapter-deepseek test && pnpm --filter @coa/adapter-deepseek typecheck && pnpm --filter @coa/adapter-longcat test && pnpm --filter @coa/adapter-longcat typecheck`
Expected: PASS, exit 0.

- [ ] **Step 7: Same-commit doc — M9 adapters**

In `docs/design/handoff/spec/M9.md`, add one line: the pure-API adapters stream via SSE (`stream: true`), yielding text/reasoning deltas from `complete()` and returning the assembled settled result (docs/adr/0013).

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-deepseek/src/sse.ts packages/adapter-deepseek/src/complete.ts \
  packages/adapter-deepseek/src/wire.ts packages/adapter-deepseek/src/complete.test.ts \
  packages/adapter-longcat/src/sse.ts packages/adapter-longcat/src/complete.ts \
  packages/adapter-longcat/src/wire.ts packages/adapter-longcat/src/complete.test.ts \
  docs/design/handoff/spec/M9.md
git commit -m "feat: stream pure-api completions over server-sent events"
```

---

## Task 5: Interrupt mid-stream keeps + marks the partial (A1)

**Files:**
- Modify: `packages/loop-driver/src/driver.ts` (wrap the generator drain in try/catch)
- Test: `packages/loop-driver/src/driver.test.ts`

**Interfaces:**
- Consumes: `deps.signal` (already present), the delta drain (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
it('on interrupt mid-stream, keeps the streamed partial as one settled text frame marked interrupted', async () => {
  const controller = new AbortController();
  const frames: TurnFrame[] = [];
  async function* streamThenAbort(): AsyncGenerator<CompletionDelta, CompletionResult> {
    yield { kind: 'text', text: 'Par' };
    yield { kind: 'text', text: 'tial' };
    controller.abort();
    // the adapter's next read observes the abort and throws
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  }
  await runGovernedLoop({
    sessionId: 's', complete: streamThenAbort, catalogue: [], systemPrompt: '', input: 'hi',
    canUseTool: async () => ({ behavior: 'allow' }) as never,
    gate: async () => ({ allow: true }),
    signal: controller.signal,
    onTurn: (f) => frames.push(f),
  });
  expect(frames).toContainEqual({ t: 'text-delta', text: 'Par' });
  expect(frames).toContainEqual({ t: 'text-delta', text: 'tial' });
  // one settled text frame carrying the partial + marker; NO normal settled 'text' of full output
  expect(frames).toContainEqual({ t: 'text', text: 'Partial\n\n[interrupted]' });
  expect(frames.filter((f) => f.t === 'text')).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/loop-driver/src/driver.test.ts -t "on interrupt mid-stream"`
Expected: FAIL — the AbortError propagates out of `runGovernedLoop` (rejects); no marked settled frame is emitted.

- [ ] **Step 3: Wrap the drain in try/catch**

In `driver.ts`, replace the generator-drain block from Task 2 with:

```ts
      const it = deps.complete(messages, tools, deps.signal);
      let partialText = '';
      let step: IteratorResult<CompletionDelta, CompletionResult>;
      try {
        step = await it.next();
        while (step.done !== true) {
          const delta = step.value;
          if (delta.kind === 'text') { partialText += delta.text; emit({ t: 'text-delta', text: delta.text }); }
          else emit({ t: 'thinking-delta', text: delta.text });
          step = await it.next();
        }
      } catch (err) {
        // SC-1 + A1: a user interrupt mid-stream is not an error — keep the streamed
        // partial and mark it, landing it as ONE settled `text` frame (docs/adr/0013)
        // so the append-only log has the partial. Any other throw still propagates.
        if (deps.signal?.aborted === true) {
          if (partialText !== '') emit({ t: 'text', text: `${partialText}\n\n[interrupted]` });
          break; // settle via the outer finally; interrupted-status suppression unchanged
        }
        throw err;
      }
      const result = step.value;
      addUsage(usage, result.usage);
```

(The settled `thinking`/`text` emits and `messages.push` continue unchanged below.)

Add the `CompletionDelta` type import to `driver.ts` (`import type { CompleteFn, CompletionDelta, DriverMessage, ToolDef } from './complete.js';`).

- [ ] **Step 4: Run the test + suite + typecheck**

Run: `pnpm vitest run packages/loop-driver/src/driver.test.ts && pnpm --filter @coa/loop-driver test && pnpm --filter @coa/loop-driver typecheck`
Expected: PASS, exit 0. Confirm the pre-existing "abort at loop top" test still passes (a pre-stream abort still breaks before `complete()`).

- [ ] **Step 5: Commit**

```bash
git add packages/loop-driver/src/driver.ts packages/loop-driver/src/driver.test.ts
git commit -m "feat: retain and mark the streamed partial when a turn is interrupted"
```

---

## Task 6: Claude SDK streaming (`includePartialMessages` → delta frames)

**Files:**
- Modify: `packages/adapter-claude-sdk/src/session-options.ts` (add `includePartialMessages: true`)
- Modify: `packages/adapter-claude-sdk/src/turn-frames.ts` (map `stream_event`)
- Test: `packages/adapter-claude-sdk/src/turn-frames.test.ts`

**Interfaces:**
- Consumes: the delta `TurnFrame` kinds (Task 1). `messageToEnrichedFrames` (already wraps `messageToFrames`) needs no change — a `stream_event` has no `tool_result`, so it yields `{ frame }` with no `full`.

- [ ] **Step 1: Write the failing mapper test**

In `packages/adapter-claude-sdk/src/turn-frames.test.ts`:

```ts
it('maps a content_block_delta stream_event to a text-delta frame', () => {
  const msg = { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } } } as unknown as SDKMessage;
  expect(messageToFrames(msg)).toEqual([{ t: 'text-delta', text: 'Hel' }]);
});

it('maps a thinking_delta stream_event to a thinking-delta frame', () => {
  const msg = { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } } } as unknown as SDKMessage;
  expect(messageToFrames(msg)).toEqual([{ t: 'thinking-delta', text: 'hmm' }]);
});

it('ignores non-delta stream_events', () => {
  const msg = { type: 'stream_event', event: { type: 'content_block_start', index: 0 } } as unknown as SDKMessage;
  expect(messageToFrames(msg)).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/turn-frames.test.ts -t "stream_event"`
Expected: FAIL — `stream_event` hits the `default` case → `[]`.

- [ ] **Step 3: Add the `stream_event` case**

In `packages/adapter-claude-sdk/src/turn-frames.ts`, add to the `messageToFrames` switch and a helper (use a structural read — the SDK's `stream_event` payload is a raw Anthropic `RawMessageStreamEvent`):

```ts
    case 'stream_event':
      return streamEventFrames(message);
```

```ts
/** A raw streaming event's fields this mapper reads (Anthropic RawMessageStreamEvent). */
interface StreamEvent {
  event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
}

/** Map a partial-message stream event to a delta frame (Piece B). Only content-block text/
 *  thinking deltas render; block start/stop and message-level events carry no frame. */
function streamEventFrames(message: SDKMessage): TurnFrame[] {
  const ev = (message as unknown as StreamEvent).event;
  if (ev?.type !== 'content_block_delta') return [];
  if (ev.delta?.type === 'text_delta') return [{ t: 'text-delta', text: ev.delta.text ?? '' }];
  if (ev.delta?.type === 'thinking_delta') return [{ t: 'thinking-delta', text: ev.delta.thinking ?? '' }];
  return [];
}
```

- [ ] **Step 4: Turn on `includePartialMessages`**

In `packages/adapter-claude-sdk/src/session-options.ts`, add `includePartialMessages: true` to the returned `Options` object (after `canUseTool`/`hooks`). If TS rejects the field name, verify it against the installed `@anthropic-ai/claude-agent-sdk` `Options` type (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`) and use the exact key it declares — do NOT guess; the exact key is authoritative.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @coa/adapter-claude-sdk test && pnpm --filter @coa/adapter-claude-sdk typecheck`
Expected: PASS, exit 0. (Pre-existing tests still green: a `stream_event` only appears when the SDK streams; scripted tests without one are unaffected.)

- [ ] **Step 6: Same-commit doc — M9**

In `docs/design/handoff/spec/M9.md`, add: the Claude SDK backend enables `includePartialMessages`, mapping partial-message content-block deltas to the neutral `text-delta`/`thinking-delta` frames (docs/adr/0013). One sentence.

- [ ] **Step 7: Commit**

```bash
git add packages/adapter-claude-sdk/src/turn-frames.ts packages/adapter-claude-sdk/src/session-options.ts \
  packages/adapter-claude-sdk/src/turn-frames.test.ts docs/design/handoff/spec/M9.md
git commit -m "feat: stream claude partial messages as delta frames"
```

---

## Task 7: Console — live streaming block + reconcile

**Files:**
- Modify: `packages/console-viewmodel/src/turn-map.ts` (map the two delta kinds)
- Modify: the `ChatPanel`/transcript accumulation in `apps/desktop` (grep for `pushToViewFrames`/where view `TurnFrame`s append)
- Test: `packages/console-viewmodel/src/turn-map.test.ts` + the ChatPanel test

**Interfaces:**
- Consumes: the wire delta frames. Produces: a view frame the transcript appends to the in-progress block, and a reconcile rule (a settled `text`/`thinking` replaces the live-streamed block of that channel).

- [ ] **Step 1: Grounding**

Read `packages/console-viewmodel/src/reads.ts` for the view `TurnFrame` union and read the `ChatPanel` accumulation to see how live push frames are appended today. Decide the minimal view representation: a delta maps to a `text`/`thinking` view frame carrying a `streaming: true` marker and a stable per-turn streaming id, OR the ChatPanel maintains a streaming buffer keyed by the turn. Prefer whichever matches the existing accumulation with the least new surface. Record the choice in the test.

- [ ] **Step 2: Write the failing turn-map test**

```ts
it('maps a text-delta to a streaming agent text view frame', () => {
  const [frame] = pushToViewFrames({ kind: 'turn', sessionId: 's', worktree: 'w', seq: 1, frame: { t: 'text-delta', text: 'Hel' } } as Push);
  expect(frame).toMatchObject({ role: 'agent', kind: 'text', text: 'Hel', streaming: true });
});
it('maps a thinking-delta to a streaming thinking view frame', () => {
  const [frame] = pushToViewFrames({ kind: 'turn', sessionId: 's', worktree: 'w', seq: 1, frame: { t: 'thinking-delta', text: 'hm' } } as Push);
  expect(frame).toMatchObject({ role: 'agent', kind: 'thinking', text: 'hm', streaming: true });
});
```

(Adjust the exact view-frame shape to the representation chosen in Step 1; if the chosen shape has no `streaming` flag, assert whatever marks it as an in-progress delta.)

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run packages/console-viewmodel/src/turn-map.test.ts -t "delta"`
Expected: FAIL — the `default` case drops the delta kinds.

- [ ] **Step 4: Add the mapping + reconcile**

Add `text-delta`/`thinking-delta` cases to `mapFrame` in `turn-map.ts` (add the `streaming` marker to the relevant view-frame types in `reads.ts` if that's the chosen shape). In the `ChatPanel`, append a delta to the active streaming block; when a settled `text`/`thinking` frame arrives, replace that block with the settled content (no double-render). Add a `ChatPanel` test asserting: two text-deltas render a growing block, then a settled `text` replaces it and the frame count does not double.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @coa/console-viewmodel test && pnpm --filter @coa/console-viewmodel typecheck && pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected: PASS, exit 0. (Package name for `apps/desktop` — confirm from its `package.json` `name` field; use that in `--filter`.)

- [ ] **Step 6: Same-commit doc — ROADMAP**

In `ROADMAP.md`, mark the streaming-output (G7) session-hardening item as landed (both backend families + console live render).

- [ ] **Step 7: Commit**

```bash
git add packages/console-viewmodel/src/turn-map.ts packages/console-viewmodel/src/reads.ts \
  packages/console-viewmodel/src/turn-map.test.ts ROADMAP.md
# plus the ChatPanel + its test, by name
git commit -m "feat: render streaming deltas into the live block and reconcile on settle"
```

---

## Task 8: Live smoke (`COA_LIVE`) + shared helper extraction

**Files:**
- Create: `packages/adapter-claude-sdk/src/live-smoke-helpers.ts` (extract the shared scaffolding)
- Modify: `packages/adapter-claude-sdk/src/{streaming,barge-in,sot}-smoke.live.test.ts` (import the shared helpers)
- Create: `packages/adapter-claude-sdk/src/streaming-output-smoke.live.test.ts`

**Interfaces:**
- Consumes: the active `personal` claude account from `~/.coa/accounts.yaml` (mirror the existing live smokes' locator resolution).

- [ ] **Step 1: Extract shared helpers**

Read the three existing `*.live.test.ts` files; lift their duplicated helpers (`createPushQueue`/`waitForCondition`/`resolveLiveLocator` and any shared setup) into `live-smoke-helpers.ts`, exported. Update the three files to import them. Run `pnpm --filter @coa/adapter-claude-sdk test` (default-skip suite) — still green, unchanged count minus the removed dupes.

- [ ] **Step 2: Write the streaming-output live smoke**

Create `streaming-output-smoke.live.test.ts`, `describe.skipIf(!process.env.COA_LIVE)`, mirroring the existing smokes. Assertions:
- A real turn emits **multiple** `text-delta` frames before its settled `text` frame (proves `includePartialMessages` streams).
- The concatenation of the `text-delta` texts equals the settled `text` frame's text (delivery == record).
- A `COA_LIVE` interrupt mid-generation leaves a settled `text` frame containing the partial + `[interrupted]` (or — if the live run shows the SDK does NOT emit a settled block on interrupt — record the observed frame window and adjust the SDK adapter to synthesize the marked settled frame from accumulated deltas; the live behavior is authoritative, per the spec §7).

```ts
import { describe, expect, it } from 'vitest';
// import { resolveLiveLocator, createPushQueue, waitForCondition } from './live-smoke-helpers.js';

describe.skipIf(!process.env.COA_LIVE)('streaming output (live)', () => {
  it('streams multiple text-delta frames whose concat equals the settled text', async () => {
    // build the adapter with the resolved personal locator; run a short prompt;
    // collect frames; assert >1 text-delta and concat === settled text.
  }, 120_000);
});
```

- [ ] **Step 3: Run the default (skipped) suite**

Run: `pnpm --filter @coa/adapter-claude-sdk test`
Expected: PASS; the live file is skipped (no `COA_LIVE`), suite green.

- [ ] **Step 4: Run the live smoke (controller, account-gated)**

Run: `COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/streaming-output-smoke.live.test.ts`
Expected: PASS against the real `personal` account. If the account is rate-limited, report **BLOCKED** and leave the file committed + skipped (the gate is authoritative but non-CI). Confirm accounts first: `coa auth list`.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/live-smoke-helpers.ts \
  packages/adapter-claude-sdk/src/streaming-output-smoke.live.test.ts \
  packages/adapter-claude-sdk/src/streaming-smoke.live.test.ts \
  packages/adapter-claude-sdk/src/barge-in-smoke.live.test.ts \
  packages/adapter-claude-sdk/src/sot-smoke.live.test.ts
git commit -m "test: verify streaming output against the live backend"
```

---

## Closing (controller, not a subagent task)

- **Whole-workspace verify:** `pnpm -r typecheck` (all exit 0) and the touched package suites green; note the known unrelated `apps/desktop` `ShowcasePanel.test.tsx` flake (passes in isolation).
- **`pnpm docs:check`** green except the maintainer's untracked `project.md` (external — never touch).
- **OPUS whole-branch final review** over `85fab92..HEAD` (the spec commit is the base). Trust it — it caught Criticals every per-task review missed on C and E. If the shared session limit is hit, review inline on the controller's opus session (as C/E did) and note it in the ledger.
- **SDD ledger:** append a `PIECE B` section to `.superpowers/sdd/progress.md` as you go (do not redo prior work).

## Self-Review (done at plan-writing time)

- **Spec coverage:** §2 forks → Tasks 1/2/5/6 (frame kind, signature, marking, reasoning-channel); §3 types → Task 2; §4 pure-API flow → Tasks 2+4; §5 SDK flow → Task 6; §6 E-seam → Task 3; §7 interrupt → Task 5; §8 console → Task 7; §10 invariants → the #11329 test (Task 3), D85 degrade (Task 2), A1 (Task 5); §11 verification → per-task units + Task 8 live + same-commit docs (Tasks 2/3/4/6/7). All covered.
- **Placeholder scan:** none — every code step carries real code; the one genuinely live-gated unknown (SDK interrupt-partial emission) is explicitly delegated to Task 8 per the spec, not hidden as a TODO.
- **Type consistency:** `CompletionDelta` `{kind:'text'|'reasoning'}` and the frame kinds `text-delta`/`thinking-delta` are used identically across Tasks 1/2/3/5/6/7; `CompleteFn`'s `AsyncGenerator<CompletionDelta, CompletionResult>` return is consumed with `.next()`/`step.done`/`step.value` consistently in Tasks 2 and 5.

---

_Last reviewed: 2026-07-09_
