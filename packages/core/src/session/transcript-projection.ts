import type { BackendMessage, LoopToolCall, TurnFrame } from '@coa/shared';

/**
 * The append-only conversation log's entry: the UNCHANGED the shared schema layer wire
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

/** The notice a user interrupt (bare stop) folds into, so the model's next turn reads that its
 *  previous response was cut off rather than completed. Mirrors the coding-agent convention. */
export const INTERRUPTED_BY_USER = '[Request interrupted by user]';

/** The notice a governed stop folds into, so a resumed conversation reads why the previous
 *  run ended rather than appearing to have stopped for no reason. Every governed deny
 *  surfaces here. */
export const deniedNotice = (denyKind: string, reason: string): string =>
  `[Stopped by coa: ${denyKind} — ${reason}]`;

/**
 * One session's running fold state — the `issued` handle set and the open assistant
 * accumulator, pulled out of the per-frame switch so `foldEventsToTranscript` and
 * {@link foldTreeToTranscript} drive the exact same logic, one state per originating
 * session. That sharing is what makes the tree join's two integrity guarantees
 * structural rather than incidental: a session's own state can never see another
 * session's handles or open turn, because each session gets its own `FoldState`.
 */
interface FoldState {
  readonly issued: Set<string>;
  assistant: BackendMessage | undefined;
}

const newFoldState = (): FoldState => ({ issued: new Set<string>(), assistant: undefined });

/** Push `state`'s open assistant turn (if any) to `push`, skipping a wholly-empty one
 *  (no text, no tool calls) — matching the retired `messageToBackendMessages`, so the
 *  fold stays byte-parity with the old path and never emits a stray
 *  `{ role:'assistant', content:'' }`. */
function closeAssistant(state: FoldState, push: (message: BackendMessage) => void): void {
  if (state.assistant !== undefined) {
    if (state.assistant.content !== '' || (state.assistant.toolCalls?.length ?? 0) > 0) {
      push(state.assistant);
    }
    state.assistant = undefined;
  }
}

/**
 * Fold one event into `state`, pushing any completed message to `push`. The one
 * per-frame fold decision both `foldEventsToTranscript` (a single `FoldState`) and
 * the tree join (one `FoldState` per session, driven over a merged/ordered event
 * stream) share — see {@link FoldState}.
 */
function foldFrame(
  state: FoldState,
  push: (message: BackendMessage) => void,
  { frame, full }: PersistedEvent,
): void {
  switch (frame.t) {
    case 'text':
      if (frame.role === 'user' || frame.role === 'system') {
        // A `system` delivery rides the `user` role live (the Messages API has no
        // other slot for mid-conversation input) — replay must reproduce exactly
        // that, not fold it into the assistant's own text.
        closeAssistant(state, push);
        push({ role: 'user', content: frame.text });
      } else {
        // Assistant text: open or extend the current assistant message.
        if (state.assistant === undefined) state.assistant = { role: 'assistant', content: '' };
        state.assistant.content += frame.text;
      }
      break;
    case 'tool_use': {
      if (state.assistant === undefined) state.assistant = { role: 'assistant', content: '' };
      state.issued.add(frame.handle);
      const call: LoopToolCall = { id: frame.handle, name: frame.tool, arguments: frame.input };
      state.assistant.toolCalls = [...(state.assistant.toolCalls ?? []), call];
      break;
    }
    case 'tool_result':
      // An orphaned result (no prior tool_use with this handle) answers no assistant
      // tool call; emitting it would invalidate the transcript (an OpenAI-compatible
      // endpoint 400s on a tool message pairing with nothing) — so drop it. Current
      // producers always emit tool_use first, but the fold is the integrity boundary.
      if (!state.issued.has(frame.handle)) break;
      // A matched result closes the assistant turn that issued the call(s).
      closeAssistant(state, push);
      push({ role: 'tool', toolCallId: frame.handle, content: full ?? frame.pointer });
      break;
    case 'turn-boundary':
      closeAssistant(state, push);
      break;
    case 'interrupted':
      // A user stop: close whatever partial the model got out, then record the notice so the
      // next turn's context shows it was interrupted (a user action, never an error).
      closeAssistant(state, push);
      push({ role: 'user', content: INTERRUPTED_BY_USER });
      break;
    case 'deny':
      // A governed stop (a deliberate block, not a fault): close whatever partial the model got
      // out, then record why — same shape as `interrupted`, since this projection also
      // rebuilds context on resume. A close-gate reason is instructional ("resolve or
      // baseline before finishing") and would otherwise be lost entirely.
      closeAssistant(state, push);
      push({ role: 'user', content: deniedNotice(frame.denyKind, frame.reason) });
      break;
    case 'thinking':
    case 'error':
    case 'reconcile':
    case 'permission':
    case 'subagent':
      // No transcript memory — these frames are dropped.
      break;
    case 'text-delta':
    case 'thinking-delta':
      // Delivery-only: the E-seam never appends these to the
      // durable log, so they should never reach the fold — dropped defensively.
      break;
    default: {
      // A future TurnFrame kind must make an explicit fold decision above.
      const _exhaustive: never = frame;
      void _exhaustive;
      break;
    }
  }
}

/**
 * Fold the append-only event log into the provider-neutral transcript (system omitted)
 * — the read-time projection that replaces the whole-rewrite `messages.json`.
 * Assistant `text`/`tool_use` frames group into one assistant message
 * until a `tool_result` (or a user turn / boundary) closes it; `tool_result` frames
 * become `tool` messages (full body from `full`, else the frame pointer). Thinking/
 * error/reconcile/permission/subagent frames carry no transcript memory and are
 * dropped. A `deny` frame (like `interrupted`) folds into an explicit notice, since
 * this projection also rebuilds context on resume — a governed stop needs its own
 * record, not just the live turn's. Every unmatched tool call is REPAIRED (a
 * synthesized paired result), never dropped — so the assistant turn survives and
 * cross-provider replay stays valid.
 */
export function foldEventsToTranscript(events: readonly PersistedEvent[]): BackendMessage[] {
  const out: BackendMessage[] = [];
  const state = newFoldState();
  const push = (message: BackendMessage): void => {
    out.push(message);
  };
  for (const event of events) foldFrame(state, push, event);
  closeAssistant(state, push);
  return repairUnpairedToolCalls(out);
}

/**
 * Project a whole session TREE (a root plus its descendants — any depth, since
 * `descendantsOf` already returns the flat set) as one read. This is a READ-TIME JOIN
 * only: each session keeps its own append-only `events.ndjson`; there
 * is no merged log and no second writer. A root with no descendants degrades to
 * `foldEventsToTranscript` verbatim (strict superset, byte-identical).
 *
 * NO PRODUCTION CALLER YET — deliberately kept, not scaffolding to delete. A parent
 * reads a child's `events.ndjson` directly and the console groups by
 * lineage instead (`console-viewmodel`'s `groupSessionTree`), so nothing reaches this
 * today. Note that the obvious-looking wiring is the wrong one: folding a tree into
 * `conversation-store`'s `loadBackendMessages` would push a child's output into the
 * PARENT'S MODEL CONTEXT, which a notice is not a message explicitly decided against. A consumer
 * needs its own decision about who is allowed to see a merged tree.
 *
 * Ordering merges every session's events into one stream sorted by `seq` (ascending),
 * tying on session id. `seq` is a per-session monotonic counter — each session's log
 * starts it at 0 independently (frame-recorder.ts's `seqBox`), not a shared
 * clock — so this does not reconstruct true cross-session wall-clock order. It IS a
 * TOTAL, deterministic order (session ids are unique, so ties never remain unresolved),
 * which is what repeatability actually requires: two runs over the same data always
 * agree, regardless of the `descendants` map's own iteration/insertion order.
 *
 * Each session gets its OWN {@link FoldState} while the merged stream is folded, and
 * the unmatched-tool-call repair (see {@link repairUnpairedToolCalls}) is likewise
 * scoped per session below — both are the integrity boundary interleaving several
 * logs puts at risk: without per-session scoping, a `tool_use`/`tool_result` handle
 * that happens to collide across two unrelated sessions could pair a call in one with
 * a result from the other, or wrongly mark a genuinely stranded call "already
 * answered." Scoping state and repair by originating session makes that structurally
 * impossible rather than merely untested.
 */
export function foldTreeToTranscript(
  rootEvents: readonly PersistedEvent[],
  descendants: ReadonlyMap<string, readonly PersistedEvent[]>,
): BackendMessage[] {
  if (descendants.size === 0) return foldEventsToTranscript(rootEvents);

  // A synthetic key for the root's OWN events, needed only to break a same-`seq` tie
  // against a descendant. Session ids are always non-empty (daemon-generated), so ''
  // can never collide with a real descendant id; being the empty string, it also
  // always sorts first among ties — an arbitrary but FIXED choice, not a claim that
  // the root's events are chronologically first (see the ordering note above). Enforced
  // at runtime, not just documented: a descendant keyed by '' would silently share the
  // root's own fold state, corrupting both — a corruption worth failing loudly on rather
  // than degrading through, since it can only arise from a caller building the map wrong.
  const ROOT = '';
  if (descendants.has(ROOT)) {
    throw new Error(
      "foldTreeToTranscript: a descendant session id must not be the empty string (reserved for the root's own events)",
    );
  }
  const tagged: { sessionId: string; event: PersistedEvent }[] = [
    ...rootEvents.map((event) => ({ sessionId: ROOT, event })),
    ...Array.from(descendants, ([sessionId, events]) =>
      events.map((event) => ({ sessionId, event })),
    ).flat(),
  ];
  tagged.sort((a, b) => a.event.seq - b.event.seq || a.sessionId.localeCompare(b.sessionId));

  // Each session id's LAST index in the sorted stream — so a still-open assistant turn
  // (no closing `tool_result`/`turn-boundary`/etc.) can be closed the instant its
  // session's own contribution ends, at that exact position in the total order, rather
  // than deferred to after the whole stream. Deferring it (a single post-loop pass over
  // every open session) would silently violate the very `(seq, sessionId)` order this
  // function documents: an open-ended trailing session would always land last, even
  // when its last real event sorts well before another session's later content — and a
  // session mid-turn (still open) is the common shape for a live tree, not a rare one.
  const lastIndexOf = new Map<string, number>();
  tagged.forEach(({ sessionId }, index) => lastIndexOf.set(sessionId, index));

  const states = new Map<string, FoldState>();
  const stateFor = (sessionId: string): FoldState => {
    const existing = states.get(sessionId);
    if (existing !== undefined) return existing;
    const created = newFoldState();
    states.set(sessionId, created);
    return created;
  };

  const out: { sessionId: string; message: BackendMessage }[] = [];
  for (const [index, { sessionId, event }] of tagged.entries()) {
    const state = stateFor(sessionId);
    const push = (message: BackendMessage): void => {
      out.push({ sessionId, message });
    };
    foldFrame(state, push, event);
    if (lastIndexOf.get(sessionId) === index) closeAssistant(state, push);
  }

  return repairUnpairedToolCallsPerSession(out);
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
  for (const m of messages)
    if (m.role === 'tool' && m.toolCallId !== undefined) answered.add(m.toolCallId);
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

/**
 * {@link repairUnpairedToolCalls}, scoped per originating session — the tree join's
 * counterpart. `answered` (and therefore what counts as "still unanswered, needs a
 * synthesized result") is tracked PER SESSION: without that, a real result from one
 * session could wrongly mark a genuinely stranded call in an unrelated session
 * "already answered" merely because both happened to use the same handle string
 * (tool-call handles are unique within a session, never guaranteed unique across
 * sessions). Reused by {@link foldTreeToTranscript} only; not exported, since a
 * single-session caller has `repairUnpairedToolCalls` already.
 */
/**
 * The last non-empty assistant message in a folded transcript — what a completion
 * notice quotes as a session's "result" (see `notify.ts`'s `renderChildEnded` and
 * its caller in `session-service.ts`). Walking from the end rather than joining
 * every assistant message is deliberate: a session's own transcript can contain
 * several assistant turns (one per internal tool round-trip), and everything
 * before the last one is the WORK, not the answer — concatenating all of it would
 * hand the reader a jumble of intermediate reasoning fragments instead of the one
 * message the session actually finished on. `undefined` when the session produced
 * no assistant text at all (a pure tool-only run, or an interrupted one).
 */
export function latestAssistantText(messages: readonly BackendMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'assistant' && message.content.trim() !== '') return message.content;
  }
  return undefined;
}

function repairUnpairedToolCallsPerSession(
  tagged: readonly { sessionId: string; message: BackendMessage }[],
): BackendMessage[] {
  const answered = new Map<string, Set<string>>();
  const answeredFor = (sessionId: string): Set<string> => {
    const existing = answered.get(sessionId);
    if (existing !== undefined) return existing;
    const created = new Set<string>();
    answered.set(sessionId, created);
    return created;
  };
  for (const { sessionId, message } of tagged) {
    if (message.role === 'tool' && message.toolCallId !== undefined) {
      answeredFor(sessionId).add(message.toolCallId);
    }
  }
  const out: BackendMessage[] = [];
  for (const { sessionId, message } of tagged) {
    out.push(message);
    if (message.role === 'assistant' && message.toolCalls !== undefined) {
      const set = answeredFor(sessionId);
      for (const call of message.toolCalls) {
        if (!set.has(call.id)) {
          out.push({ role: 'tool', toolCallId: call.id, content: INTERRUPTED });
          set.add(call.id); // guard against duplicate ids within the same session
        }
      }
    }
  }
  return out;
}
