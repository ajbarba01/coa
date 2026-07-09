# Append-only single source of truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge conversation persistence onto ONE append-only event log (`events.ndjson`) as the sole source of truth, deriving the lossy UI view AND the provider-shaped transcript as read-time projections — killing the two-store divergence class structurally.

**Architecture:** A per-session `events.ndjson` of `{seq, frame, full?}` lines is the only writer. `reload` projects the `frame` stream (UI, unchanged); `loadBackendMessages` FOLDS the log into `BackendMessage[]` at read time, repairing any unpaired tool_use by synthesizing a paired result (keyed by call-id set membership, not position — per the OSS survey). Each adapter emits ONE enriched frame stream (`onTurn(frame, full?)`); the separate `onBackendMessages`/`saveBackendMessages` write-path and the write-time `dropTrailingDanglingToolCall`/`lastConsistent` trims are retired.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`) · pnpm workspaces · Vitest · `@anthropic-ai/claude-agent-sdk`.

## Global Constraints

- **TypeScript `strict`, no `any`.** Run `pnpm --filter <pkg> typecheck` for every touched package — Vitest transpiles WITHOUT full typechecking. Optional fields via guarded spreads (`...(x !== undefined ? { x } : {})`), never `x: undefined`.
- **D85 strict-superset** — a clean one-turn conversation's folded transcript is byte-identical to today's `messages.json` for that turn; the console UI view (`reload`) is unchanged; `coa raw` sacred.
- **SC-1** — no new block/error path; steer/interrupt stay user actions.
- **Neutral seam (ADR 0002/0004)** — the fold is backend-neutral (over M0 `TurnFrame`s); no backend type crosses M8; composition never branches on backend.
- **Memory correctness** — the folded transcript contains every user/steer turn verbatim and every assistant/tool round-trip, with valid tool_use↔tool_result pairing (an OpenAI-compatible endpoint 400s on an assistant `tool_calls` turn with an unmatched call — the repair prevents this by synthesis).
- **`full` is persistence-only** — it is NOT added to the M0 wire `TurnFrame` schema; the wire push stays lossy (D57). It rides only the adapter→daemon `onTurn` call and the `events.ndjson` line.
- **Fresh start** — no migration; old-format sessions (`turns.ndjson`/`messages.json`) are simply not read by the new path.
- Commit messages: subject-line-only Conventional Commits, no body/trailer, no internal identifiers in the subject. Stage BY NAME. NEVER stage `DEV-NOTES.md`, `TEMP.txt`, `project.md`.
- Some packages lack a `test` script — use `pnpm vitest run <path>`.
- `pnpm docs:check` fails ONLY on the maintainer's untracked `project.md` — external; never touch it.

---

## File Structure

- `packages/core/src/session/transcript-projection.ts` — NEW: `PersistedEvent` type + `foldEventsToTranscript` + `repairUnpairedToolCalls` (pure).
- `packages/core/src/session/conversation-store.ts` — `events.ndjson` append of `PersistedEvent`; `loadBackendMessages` → fold; `reload` → frame projection; retire `saveBackendMessages`.
- `packages/core/src/session/session.ts` — `onTurn` gains `full?`; retire `onBackendMessages` from `SessionAdapterInit` + `createSession` req + the `createAdapter` forward.
- `packages/core/src/session/session-handlers.ts` — `record(frame, full?)` → single append + lossy push; delete `onBackendMessages`/`saveBackendMessages` from `buildPersistenceHooks` and both drive paths.
- `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts` + `src/enriched-frames.ts` (NEW) — emit `onTurn(frame, full)`; delete the transcript accumulation / `onBackendMessages`.
- `packages/adapter-claude-sdk/src/transcript.ts` — delete `messageToBackendMessages`/`tapStreamedUserTurns`/`dropTrailingDanglingToolCall` (moved to the fold) — or keep only what `enriched-frames.ts` reuses (`resultText`).
- `packages/loop-driver/src/driver.ts` — drop `onMessages`/`lastConsistent`; emit `full` on `tool_result`; emit a user frame per injected steer.
- `packages/adapter-deepseek/src/adapter.ts` + `packages/adapter-longcat/src/adapter.ts` — map `onBackendMessages` away; forward enriched `onTurn`.

---

## Task 1: The fold — `foldEventsToTranscript` + `repairUnpairedToolCalls`

**Files:**
- Create: `packages/core/src/session/transcript-projection.ts`
- Test: `packages/core/src/session/transcript-projection.test.ts`

**Interfaces:**
- Produces: `interface PersistedEvent { seq: number; frame: TurnFrame; full?: string }`; `foldEventsToTranscript(events: readonly PersistedEvent[]): BackendMessage[]`; `repairUnpairedToolCalls(messages: readonly BackendMessage[]): BackendMessage[]`.
- Consumes: `TurnFrame`, `BackendMessage`, `LoopToolCall` from `@coa/shared`.

- [ ] **Step 1: Write the failing tests.** Create `transcript-projection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { TurnFrame } from '@coa/shared';
import { foldEventsToTranscript, repairUnpairedToolCalls, type PersistedEvent } from './transcript-projection.js';

const ev = (seq: number, frame: TurnFrame, full?: string): PersistedEvent =>
  full !== undefined ? { seq, frame, full } : { seq, frame };

describe('foldEventsToTranscript', () => {
  it('folds a clean turn: user, assistant text + tool_use, tool_result, assistant answer', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'do it', role: 'user' }),
      ev(1, { t: 'text', text: 'working' }),
      ev(2, { t: 'tool_use', tool: 'Read', input: { path: 'a' }, handle: 'h1' }),
      ev(3, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'short' }, 'FULL FILE BODY'),
      ev(4, { t: 'text', text: 'done' }),
      ev(5, { t: 'turn-boundary', role: 'assistant' }),
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'do it' },
      { role: 'assistant', content: 'working', toolCalls: [{ id: 'h1', name: 'Read', arguments: { path: 'a' } }] },
      { role: 'tool', toolCallId: 'h1', content: 'FULL FILE BODY' },
      { role: 'assistant', content: 'done' },
    ]);
  });

  it('drops thinking/error/reconcile/permission/subagent frames (not in the transcript)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'hi', role: 'user' }),
      ev(1, { t: 'thinking', text: 'hmm' }),
      ev(2, { t: 'text', text: 'reply' }),
      ev(3, { t: 'error', message: 'boom', origin: 'loop' }),
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('uses `full` for the tool message content, falling back to the frame pointer when absent', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'x', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'T', input: {}, handle: 'h1' }),
      ev(2, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'PTR' }), // no full
    ];
    const out = foldEventsToTranscript(events);
    expect(out.find((m) => m.role === 'tool')).toEqual({ role: 'tool', toolCallId: 'h1', content: 'PTR' });
  });

  it('repairs an interrupted trailing tool_use (synthesize a paired result, not drop the assistant turn)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'go', role: 'user' }),
      ev(1, { t: 'text', text: 'calling' }),
      ev(2, { t: 'tool_use', tool: 'Bash', input: { cmd: 'x' }, handle: 'h9' }), // no result → interrupted
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'calling', toolCalls: [{ id: 'h9', name: 'Bash', arguments: { cmd: 'x' } }] },
      { role: 'tool', toolCallId: 'h9', content: '[Tool execution was interrupted]' },
    ]);
  });

  it('repairs a STRANDED non-last call in a parallel batch (set membership, not position)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'go', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'A', input: {}, handle: 'h1' }),
      ev(2, { t: 'tool_use', tool: 'B', input: {}, handle: 'h2' }),
      ev(3, { t: 'tool_result', handle: 'h2', ok: true, pointer: 'p' }, 'B-RESULT'), // h1 stranded
    ];
    const out = foldEventsToTranscript(events);
    // both calls are answered — h1 synthesized, h2 real — inserted after their assistant message
    expect(out.filter((m) => m.role === 'tool')).toEqual([
      { role: 'tool', toolCallId: 'h1', content: '[Tool execution was interrupted]' },
      { role: 'tool', toolCallId: 'h2', content: 'B-RESULT' },
    ]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).

Run: `pnpm vitest run packages/core/src/session/transcript-projection.test.ts`
Expected: FAIL (cannot find `./transcript-projection.js`).

- [ ] **Step 3: Implement the fold.** Create `packages/core/src/session/transcript-projection.ts`:

```ts
import type { BackendMessage, LoopToolCall, TurnFrame } from '@coa/shared';

/**
 * The append-only conversation log's entry (docs/adr/0010): the UNCHANGED M0 wire
 * frame plus, for a `tool_result`, the FULL body the model saw (the only thing the
 * lossy UI frame drops). `full` is persistence-only — never on the wire.
 */
export interface PersistedEvent {
  seq: number;
  frame: TurnFrame;
  full?: string;
}

/** The synthetic body a repaired (interrupted / stranded) tool call gets. */
const INTERRUPTED = '[Tool execution was interrupted]';

/**
 * Fold the append-only event log into the provider-neutral transcript (system omitted)
 * — the read-time projection that replaces the whole-rewrite `messages.json`
 * (docs/adr/0010). Assistant `text`/`tool_use` frames group into one assistant message
 * until a `tool_result` (or a user turn / boundary) closes it; `tool_result` frames
 * become `tool` messages (full body from `full`, else the frame pointer). Thinking/
 * error/reconcile/permission/subagent frames carry no transcript memory and are
 * dropped. Every unmatched tool call is REPAIRED (a synthesized paired result), never
 * dropped — so the assistant turn survives and cross-provider replay stays valid.
 */
export function foldEventsToTranscript(events: readonly PersistedEvent[]): BackendMessage[] {
  const out: BackendMessage[] = [];
  let assistant: BackendMessage | undefined;
  const closeAssistant = (): void => {
    if (assistant !== undefined) {
      out.push(assistant);
      assistant = undefined;
    }
  };
  for (const { frame, full } of events) {
    switch (frame.t) {
      case 'text':
        if (frame.role === 'user') {
          closeAssistant();
          out.push({ role: 'user', content: frame.text });
        } else {
          // Assistant text: open or extend the current assistant message.
          if (assistant === undefined) assistant = { role: 'assistant', content: '' };
          assistant.content += frame.text;
        }
        break;
      case 'tool_use': {
        if (assistant === undefined) assistant = { role: 'assistant', content: '' };
        const call: LoopToolCall = { id: frame.handle, name: frame.tool, arguments: frame.input };
        assistant.toolCalls = [...(assistant.toolCalls ?? []), call];
        break;
      }
      case 'tool_result':
        // A result closes the assistant turn that issued the call(s).
        closeAssistant();
        out.push({ role: 'tool', toolCallId: frame.handle, content: full ?? frame.pointer });
        break;
      case 'turn-boundary':
        closeAssistant();
        break;
      // thinking / error / reconcile / permission / subagent → no transcript memory.
      default:
        break;
    }
  }
  closeAssistant();
  return repairUnpairedToolCalls(out);
}

/**
 * Guarantee every assistant `toolCall.id` has a matching `tool` message — synthesizing
 * a paired result for any that don't (an interrupt / mid-tool crash, or a stranded
 * non-last call in a parallel batch). Keyed by id SET MEMBERSHIP, not list position
 * (docs/design/research/2026-07-09-append-only-persistence-oss.md — the convergent OSS
 * practice: synthesize, don't drop). A synthesized result is inserted immediately after
 * its assistant message, before the next message.
 */
export function repairUnpairedToolCalls(messages: readonly BackendMessage[]): BackendMessage[] {
  const answered = new Set<string>();
  for (const m of messages) if (m.role === 'tool' && m.toolCallId !== undefined) answered.add(m.toolCallId);
  const out: BackendMessage[] = [];
  for (const m of messages) {
    out.push(m);
    if (m.role === 'assistant' && m.toolCalls !== undefined) {
      for (const call of m.toolCalls) {
        if (!answered.has(call.id)) {
          out.push({ role: 'tool', toolCallId: call.id, content: INTERRUPTED });
          answered.add(call.id); // guard against duplicate ids
        }
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `pnpm vitest run packages/core/src/session/transcript-projection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck.**

Run: `pnpm --filter @coa/core typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/session/transcript-projection.ts packages/core/src/session/transcript-projection.test.ts
git commit -m "feat: fold an append-only event log into the provider transcript"
```

---

## Task 2: Store — `events.ndjson` append + projections; retire `saveBackendMessages`

**Files:**
- Modify: `packages/core/src/session/conversation-store.ts`
- Test: `packages/core/src/session/conversation-store.test.ts`

**Interfaces:**
- Consumes: `PersistedEvent`, `foldEventsToTranscript` (Task 1).
- Produces: `append(id, events: PersistedEvent[])`; `reload(id, toSeq?) → PersistedTurn[]` (frame only); `loadBackendMessages(id) → BackendMessage[]` (fold of the log); `saveBackendMessages` REMOVED from `ConversationStore`.

- [ ] **Step 1: Write the failing test.** In `conversation-store.test.ts`, add (adapt to the file's existing `createConversationStore(tmpDir)` harness):

```ts
it('append writes events.ndjson; loadBackendMessages folds it (no messages.json)', () => {
  const store = createConversationStore(tmpDir());
  store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
  store.append('c1', [
    { seq: 0, frame: { t: 'text', text: 'hi', role: 'user' } },
    { seq: 1, frame: { t: 'tool_use', tool: 'Read', input: { p: 'a' }, handle: 'h1' } },
    { seq: 2, frame: { t: 'tool_result', handle: 'h1', ok: true, pointer: 'ptr' }, full: 'FULLBODY' },
    { seq: 3, frame: { t: 'text', text: 'done' } },
    { seq: 4, frame: { t: 'turn-boundary', role: 'assistant' } },
  ]);
  // Transcript = the fold (full body preserved), NOT the pointer.
  expect(store.loadBackendMessages('c1')).toEqual([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'h1', name: 'Read', arguments: { p: 'a' } }] },
    { role: 'tool', toolCallId: 'h1', content: 'FULLBODY' },
    { role: 'assistant', content: 'done' },
  ]);
  // UI view = the frame stream (full dropped).
  expect(store.reload('c1').map((t) => t.frame.t)).toEqual(['text', 'tool_use', 'tool_result', 'text', 'turn-boundary']);
  expect(store.reload('c1').every((t) => !('full' in t))).toBe(true);
});

it('loadBackendMessages returns [] for a session with no events (fresh start; old files ignored)', () => {
  const store = createConversationStore(tmpDir());
  store.create({ id: 'c2', agentRef: 'r', title: 't', scope: '' });
  expect(store.loadBackendMessages('c2')).toEqual([]);
});
```

- [ ] **Step 2: Run — expect FAIL** (append signature / no fold; `saveBackendMessages` may still exist).

Run: `pnpm vitest run packages/core/src/session/conversation-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `conversation-store.ts`:
  - Import `{ foldEventsToTranscript, type PersistedEvent }` from `./transcript-projection.js`.
  - Rename the on-disk file: `const eventsPath = (id) => join(sessionDir(id), 'events.ndjson');` (drop `messagesPath`; keep `turnsPath` deleted from use).
  - Change `PersistedTurn` to stay `{ seq: number; frame: TurnFrame }` (the UI shape `reload` returns). Add nothing to it.
  - `append(id, events: PersistedEvent[])`: `appendFileSync(eventsPath(id), events.map((e) => JSON.stringify(e) + '\n').join(''), 'utf8')`. Change the interface signature `append(id: string, events: PersistedEvent[]): void`.
  - Add a private `readEvents(id): PersistedEvent[]` mirroring today's `reload` line-parsing but validating against a `persistedEventSchema` (`z.object({ seq: z.number(), frame: turnFrameSchema, full: z.string().optional() })`), skipping garbage lines (never throw).
  - `reload(id, toSeq?)`: read events via `readEvents`, filter by `toSeq`, and return `{ seq, frame }` (drop `full`).
  - `loadBackendMessages(id)`: `return foldEventsToTranscript(readEvents(id));`.
  - DELETE `saveBackendMessages` from the interface and the impl, DELETE `loadBackendMessages`'s old `messages.json` body, DELETE `messagesPath` and `backendMessagesSchema`.
  - Update the module docstring: one append-only `events.ndjson`; `messages.json`/`turns.ndjson` retired; the transcript is a read-time fold.

- [ ] **Step 4: Run the store suite — expect PASS.** Fix any existing test that referenced `saveBackendMessages`/`messages.json` (update to the new `append`/fold model or delete if now covered).

Run: `pnpm vitest run packages/core/src/session/conversation-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck.**

Run: `pnpm --filter @coa/core typecheck`
Expected: errors ONLY at `session-handlers.ts` call sites (fixed in Task 5) — the store itself compiles. If the store file has errors, fix them; leave the `session-handlers.ts` errors for Task 5.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/session/conversation-store.ts packages/core/src/session/conversation-store.test.ts
git commit -m "feat: persist conversations as one append-only event log"
```

---

## Task 3: M9 seam — `onTurn(frame, full?)`; retire `onBackendMessages`

**Files:**
- Modify: `packages/core/src/session/session.ts`
- Test: (compile-driven; the behavioral test lands with the adapters in Task 4 and M8 in Task 5)

**Interfaces:**
- Produces: `SessionAdapterInit.onTurn?: (frame: TurnFrame, full?: string) => void`; `SessionAdapterInit.onBackendMessages` REMOVED; `createSession` req `onTurn` gains `full?`, `onBackendMessages` removed.

- [ ] **Step 1: Change `SessionAdapterInit`.** In `session.ts`, change `onTurn?: (frame: TurnFrame) => void` to `onTurn?: (frame: TurnFrame, full?: string) => void` (update its doc: "and, for a `tool_result`, the full body for the append-only log — docs/adr/0010"). DELETE the `onBackendMessages?` field and its doc.

- [ ] **Step 2: Change the `createSession` req.** Same `onTurn` signature change; DELETE the `onBackendMessages?` req field.

- [ ] **Step 3: Update the `createAdapter` forward.** In `createSession`, the `...(req.onTurn ? { onTurn: req.onTurn } : {})` line stays (the function value just has a wider signature). DELETE the `...(req.onBackendMessages ? { onBackendMessages: req.onBackendMessages } : {})` forward.

- [ ] **Step 4: Typecheck (expect downstream errors).**

Run: `pnpm --filter @coa/core typecheck`
Expected: errors at `session-handlers.ts` (Task 5) and — after Tasks 4 — the adapters must match. The `session.ts` file itself compiles.

- [ ] **Step 5: Commit** (with Task 4, since the adapters must match the seam — do NOT commit a broken seam alone). Defer the commit; proceed to Task 4 and commit them together, OR commit here only if the adapters already compile. To keep each commit green, fold Task 3's edits into Task 4's commit.

> NOTE TO IMPLEMENTER: Tasks 3 and 4 are one green unit (the seam change must land with its adapter conformance). Make the Task 3 edits, then do Task 4, then run the full typecheck across core + all three adapters, then commit once.

---

## Task 4: Adapters emit the enriched stream; drop the transcript write-path

**Files:**
- Create: `packages/adapter-claude-sdk/src/enriched-frames.ts`
- Test: `packages/adapter-claude-sdk/src/enriched-frames.test.ts`
- Modify: `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts`
- Modify: `packages/adapter-claude-sdk/src/transcript.ts` (delete moved helpers; keep `resultText` if reused)
- Modify: `packages/loop-driver/src/driver.ts`
- Modify: `packages/adapter-deepseek/src/adapter.ts`, `packages/adapter-longcat/src/adapter.ts`
- Test: `packages/loop-driver/src/driver.test.ts`, the adapters' tests

**Interfaces:**
- Consumes: the Task 3 `onTurn(frame, full?)` seam.
- Produces: `messageToEnrichedFrames(message): Array<{ frame: TurnFrame; full?: string }>` (claude-sdk); each adapter/driver calls `onTurn(frame, full)`; `ClaudeSdkAdapterInit.onBackendMessages` / `DeepSeekAdapterInit.onBackendMessages` / `LongCatAdapterInit.onBackendMessages` REMOVED; `GovernedLoopDeps.onMessages` REMOVED.

- [ ] **Step 1 (Claude): failing test for `messageToEnrichedFrames`.** Create `enriched-frames.test.ts` — a `tool_result` SDK message maps to a frame with the lossy pointer AND `full` with the complete body:

```ts
import { describe, it, expect } from 'vitest';
import { messageToEnrichedFrames } from './enriched-frames.js';

it('carries the full tool-result body as `full` alongside the lossy pointer frame', () => {
  const msg = { type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'h1', content: 'THE FULL RESULT BODY' },
  ] } } as never;
  const out = messageToEnrichedFrames(msg);
  expect(out).toEqual([
    { frame: { t: 'tool_result', handle: 'h1', ok: true, pointer: 'THE FULL RESULT BODY' }, full: 'THE FULL RESULT BODY' },
  ]);
});

it('emits a plain frame (no full) for a text/assistant message', () => {
  const msg = { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } } as never;
  expect(messageToEnrichedFrames(msg)).toEqual([{ frame: { t: 'text', text: 'hi' } }]);
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/enriched-frames.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `messageToEnrichedFrames`.** Create `enriched-frames.ts` — reuse `messageToFrames` (turn-frames.ts) for the frame and attach `full` from the SDK content for `tool_result` frames:

```ts
import type { SDKMessage, TurnFrame } from '@anthropic-ai/claude-agent-sdk'; // TurnFrame from @coa/shared
import type { TurnFrame as CoaTurnFrame } from '@coa/shared';
import { messageToFrames } from './turn-frames.js';
import { resultText } from './transcript.js'; // export resultText from transcript.ts (keep it)

export interface EnrichedFrame {
  frame: CoaTurnFrame;
  full?: string;
}

/** Map one SDK message to enriched frames: the lossy UI frame plus, for a `tool_result`,
 *  the FULL body for the append-only log (docs/adr/0010). Full is attached by matching
 *  the emitted tool_result frames to the SDK message's tool_result blocks in order. */
export function messageToEnrichedFrames(message: SDKMessage): EnrichedFrame[] {
  const frames = messageToFrames(message);
  const fulls = toolResultFullBodies(message); // [] unless a `user` message with tool_result blocks
  let ri = 0;
  return frames.map((frame) => {
    if (frame.t === 'tool_result') {
      const full = fulls[ri++];
      return full !== undefined ? { frame, full } : { frame };
    }
    return { frame };
  });
}

function toolResultFullBodies(message: SDKMessage): string[] {
  if (message.type !== 'user') return [];
  const content = message.message.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b): b is { type: 'tool_result'; content: unknown } => (b as { type?: string }).type === 'tool_result')
    .map((b) => resultText(b.content));
}
```

Export `resultText` from `transcript.ts` (change `function resultText` to `export function resultText`). Fix the import types (`SDKMessage` from the SDK; `TurnFrame` from `@coa/shared`).

- [ ] **Step 4: Run — expect PASS.**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/enriched-frames.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire the Claude adapter.** In `claude-sdk-adapter.ts` `runLoop`:
  - DELETE: `const transcript = [...]`, the `rawInput` push, the `modelPrompt` `tapStreamedUserTurns`/`withHistoryPreambleStreaming` transcript wiring is KEPT for the model prompt but the `transcript` accumulation is removed — the preamble/streaming still wrap `this.#init.input` for delivery; only the transcript recording is dropped. (Preamble delivery is model-input only, unaffected.) The `dirty` flag, the per-`result` `onBackendMessages(dropTrailingDanglingToolCall(transcript))`, and the `finally` flush all DELETE.
  - REPLACE the frame emission: `for (const { frame, full } of messageToEnrichedFrames(message)) this.#init.onTurn?.(frame, full);` (import `messageToEnrichedFrames`).
  - DELETE `ClaudeSdkAdapterInit.onBackendMessages` and `history`'s transcript role (keep `history` only if `deliverHistoryAsPreamble` still needs it for the model preamble — it does; keep `history` for preamble delivery, drop its transcript use).
  - Keep `onBackendSession`, `onSettle`, interrupt, streaming.
  - The `onTurn` type on `ClaudeSdkAdapterInit` becomes `(frame: TurnFrame, full?: string) => void`.

- [ ] **Step 6: Delete the moved transcript helpers.** In `transcript.ts`, DELETE `messageToBackendMessages`, `tapStreamedUserTurns`, `dropTrailingDanglingToolCall` (now the fold's job). KEEP `resultText` (exported, used by `enriched-frames.ts`). Delete their tests in `transcript.test.ts` (or move the `resultText` coverage). Grep for any remaining importers and update them.

- [ ] **Step 7 (pure-API driver): failing test.** In `driver.test.ts`, assert (a) an injected steer emits a `{t:'text',role:'user'}` frame, and (b) a tool_result frame carries `full` = the display:

```ts
it('emits a user text frame for an injected steer and full body on tool_result', async () => {
  const frames: Array<{ frame: unknown; full?: string }> = [];
  const onTurn = (frame: unknown, full?: string) => frames.push(full !== undefined ? { frame, full } : { frame });
  // ...drive one round-trip that calls a tool (render → 'DISPLAY BODY'), then a steer via drainSteer...
  // assert frames contains { t:'tool_result', ... } with full === 'DISPLAY BODY'
  // assert frames contains { t:'text', text:<steer>, role:'user' }
});
```

(Adapt to `driver.test.ts`'s `deps(...)` harness; `onTurn` now takes `(frame, full)`.)

- [ ] **Step 8: Rewire the driver.** In `driver.ts`:
  - `GovernedLoopDeps.onTurn?: (frame: TurnFrame, full?: string) => void`; DELETE `onMessages` and `history`'s persistence role (keep `history` — the driver still seeds `messages` from it) and the `lastConsistent` tracking + the `finally` `onMessages(messages.slice(1, lastConsistent))` flush. Keep `onSettle`.
  - On the `tool_result` emit: `emit({ t: 'tool_result', handle, ok, pointer: display }, display)` — change `emit` to forward `full`. Define `const emit = (frame, full?) => deps.onTurn?.(frame, full);`.
  - In the steer drain loops, after pushing the steer to `messages`, ALSO `emit({ t: 'text', text: steer, role: 'user' })` (both `drainSteer` and `drainQueuedSteer`). This puts the steer into the single log.
  - Remove `capToolResult`/`lastConsistent`-for-flush only where they served the deleted flush; `capToolResult` still bounds the in-memory resent `messages`, keep it.

- [ ] **Step 9: Rewire deepseek/longcat.** In each adapter: DELETE `onBackendMessages` from the init interface and the `runGovernedLoop` mapping (`...(this.#init.onBackendMessages ? { onMessages: ... } : {})` line goes). Change `onTurn` type to `(frame, full?)` and forward it unchanged (the driver already emits `full`). Remove `history`'s persistence-only comments (history still seeds the loop).

- [ ] **Step 10: Run the adapter + driver suites.** Update any test that wired `onBackendMessages`/`onMessages` to instead assert the enriched frame stream.

Run: `pnpm vitest run packages/adapter-claude-sdk packages/loop-driver packages/adapter-deepseek packages/adapter-longcat`
Expected: PASS.

- [ ] **Step 11: Typecheck core + all three adapters + cli (with Task 3 edits in place).**

Run: `pnpm --filter @coa/core typecheck && pnpm --filter @coa/adapter-claude-sdk typecheck && pnpm --filter @coa/loop-driver typecheck && pnpm --filter @coa/adapter-deepseek typecheck && pnpm --filter @coa/adapter-longcat typecheck`
Expected: 0 errors EXCEPT `session-handlers.ts` (Task 5).

- [ ] **Step 12: Commit (Tasks 3+4 together).**

```bash
git add packages/core/src/session/session.ts \
  packages/adapter-claude-sdk/src/enriched-frames.ts packages/adapter-claude-sdk/src/enriched-frames.test.ts \
  packages/adapter-claude-sdk/src/claude-sdk-adapter.ts packages/adapter-claude-sdk/src/transcript.ts packages/adapter-claude-sdk/src/transcript.test.ts \
  packages/loop-driver/src/driver.ts packages/loop-driver/src/driver.test.ts \
  packages/adapter-deepseek/src/adapter.ts packages/adapter-longcat/src/adapter.ts
git commit -m "feat: emit one enriched frame stream and retire the second transcript writer"
```

(Stage only files actually changed — check `git status`.)

---

## Task 5: M8 wiring — single append + lossy push; delete the flush discipline

**Files:**
- Modify: `packages/core/src/session/session-handlers.ts`
- Test: `packages/core/src/session/session-handlers.test.ts`

**Interfaces:**
- Consumes: the store `append(id, PersistedEvent[])` (Task 2), `onTurn(frame, full?)` (Task 3), `loadBackendMessages` fold (Task 2).
- Produces: `record(frame, full?)` appends `{seq, frame, full}` + pushes the lossy frame; `buildPersistenceHooks` no longer wires `onBackendMessages`; the `history` read path uses `loadBackendMessages` (the fold), unchanged in shape.

- [ ] **Step 1: Update both `record` closures.** In `runPerTurn` and `establishHeldQuery`, change `record` to `(frame: TurnFrame, full?: string) => { ... }`: the `session.emit(...)` pushes ONLY the frame (no `full` on the wire); the `store.append(convId, [{ seq: s, frame }])` becomes `store.append(convId, [{ seq: s, frame, ...(full !== undefined ? { full } : {}) }])`. Pass `record` as `onTurn` (the adapter now calls `record(frame, full)`).

- [ ] **Step 2: Delete `onBackendMessages` from `buildPersistenceHooks`.** Remove the `onBackendMessages: (messages) => persistIn.store.saveBackendMessages(...)` block (and the `PersistenceHooks.onBackendMessages` field). The prelude's `loadBackendMessages` read (memory plan / history) stays — it now returns the fold.

- [ ] **Step 3: Confirm the user-turn append still writes an event.** `prepareTurnPersistence`'s `store.append(id, [{ seq, frame: { t:'text', text: turn.input, role:'user' } }])` already writes a `PersistedEvent` (no `full`) — unchanged and correct.

- [ ] **Step 4: Update the tests.** In `session-handlers.test.ts`, any fake adapter that called `init.onBackendMessages` now calls `init.onTurn(frame, full)`; any assertion on persisted transcript now reads `store.loadBackendMessages` (the fold). Add a test: a mid-turn interrupt (no tool_result for a tool_use) → `loadBackendMessages` returns a transcript whose dangling call is REPAIRED (a synthesized tool message), proving the write-time flush discipline is gone and integrity is structural.

- [ ] **Step 5: Run the core session suite + typecheck.**

Run: `pnpm vitest run packages/core/src/session && pnpm --filter @coa/core typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/session/session-handlers.ts packages/core/src/session/session-handlers.test.ts
git commit -m "feat: drive conversation persistence through the single append-only log"
```

---

## Task 6: `COA_LIVE` re-verify — real Claude frames fold to a faithful transcript

**Files:**
- Modify: `packages/adapter-claude-sdk/src/barge-in-smoke.live.test.ts` (or a sibling `sot-smoke.live.test.ts`)

- [ ] **Step 1: Confirm the `personal` account is usable.** If rate-limited, STOP and report BLOCKED (do not fabricate).

- [ ] **Step 2: Add a folded-transcript assertion.** Capture the adapter's enriched `onTurn(frame, full)` stream across a held-open multi-turn run WITH a mid-turn barge-in interrupt, build `PersistedEvent[]` from it, and assert `foldEventsToTranscript(events)` yields a valid transcript: every `tool_use` id has a matching `tool` message (real or repaired), user/steer turns present verbatim, no dangling call. Import `foldEventsToTranscript` from `@coa/core`.

- [ ] **Step 3: Run live.**

Run (PowerShell): `$env:COA_LIVE=1; pnpm vitest run packages/adapter-claude-sdk/src/barge-in-smoke.live.test.ts`
Expected: PASS. Record the observed folded transcript shape in the progress ledger.

- [ ] **Step 4: Confirm the default (skipped) suite stays green.**

Run: `pnpm vitest run packages/adapter-claude-sdk`
Expected: PASS, live tests skipped.

- [ ] **Step 5: Commit.**

```bash
git add packages/adapter-claude-sdk/src/barge-in-smoke.live.test.ts
git commit -m "test: verify the folded transcript against the live claude backend"
```

---

## Task 7: Docs (same-commit rule) + whole-branch review

**Files:**
- Modify: `docs/adr/0010-append-only-conversation-log.md`, `docs/design/handoff/spec/M8.md`, `docs/design/handoff/spec/M9.md`, `ROADMAP.md`

- [ ] **Step 1: ADR 0010 → executed.** Change Status to `accepted (executed 2026-07-09)`. Add a "Delivered" note: one append-only `events.ndjson` per session; UI view + provider transcript are read-time projections; the write-time `dropTrailingDanglingToolCall` became a read-time `repairUnpairedToolCalls` (synthesize, don't drop — keyed by call-id set membership), per `docs/design/research/2026-07-09-append-only-persistence-oss.md`; `messages.json` deleted (computed on demand); streaming deltas stay out of the log. Bump `_Last reviewed:_` to 2026-07-09.

- [ ] **Step 2: M8.md + M9.md.** M8.md: the R-7 store is one append-only event log; the transcript is a read-time fold; the A1 flush discipline is retired (integrity is structural). M9.md: the adapter emits ONE enriched frame stream via `onTurn(frame, full?)`; `onBackendMessages` retired. One or two lines each; no signatures.

- [ ] **Step 3: ROADMAP.** Note ADR 0010 executed under "Session hardening" / "In flight": conversation persistence converged onto a single append-only log; the P-β M2 divergence is structurally closed. Bump `_Last reviewed:_` to 2026-07-09.

- [ ] **Step 4: Verify docs + full green.**

Run: `pnpm docs:check` → PASS except the external `project.md`.
Run: `pnpm --filter @coa/core typecheck && pnpm vitest run packages/core/src/session packages/loop-driver packages/adapter-claude-sdk packages/adapter-deepseek packages/adapter-longcat` → all green.

- [ ] **Step 5: Commit.**

```bash
git add docs/adr/0010-append-only-conversation-log.md docs/design/handoff/spec/M8.md docs/design/handoff/spec/M9.md ROADMAP.md
git commit -m "docs: record the append-only conversation log execution"
```

- [ ] **Step 6: Whole-branch review (opus).** Run the final review on opus against the piece's range. Verify: D85 (a clean one-turn folded transcript byte-identical to the old `messages.json`; `reload` UI unchanged; `coa raw`), memory correctness (every user/steer turn + valid tool pairing; repair-not-drop), SC-1, the neutral seam (the fold is backend-neutral; no backend type crosses M8), and that NO second transcript writer remains (grep `onBackendMessages`/`saveBackendMessages`/`messages.json` → gone). Fix findings before declaring complete.

---

## Self-Review (author)

- **Spec coverage:** §1 log → Task 2; §2 projections/fold + repair → Task 1 (+ store Task 2); §3 adapter seam → Tasks 3–4; §4 M8 wiring → Task 5; §5 falls-out (M2/A1) → asserted in Task 5 (interrupt→repaired) + Task 6 (live); risks → Task 6; docs → Task 7. Covered.
- **Type consistency:** `PersistedEvent {seq, frame, full?}` (Task 1) used by store (Task 2), record (Task 5), live (Task 6); `foldEventsToTranscript`/`repairUnpairedToolCalls` names stable; `onTurn(frame, full?)` consistent across session.ts (T3), adapters/driver (T4), record (T5); `messageToEnrichedFrames`/`EnrichedFrame` (T4). Consistent.
- **Placeholder scan:** Task 4 Step 7's driver test is a harness-shaped skeleton (the file-local `deps(...)` helper differs) with explicit assertion contract — the implementer fleshes it against the existing harness, as in the barge-in plan. Every non-test code step shows complete code.
- **Green-per-commit:** Tasks 3+4 are explicitly one commit (the seam + adapter conformance) so no commit is left non-compiling; Task 2 documents the expected `session-handlers.ts` errors deferred to Task 5.
