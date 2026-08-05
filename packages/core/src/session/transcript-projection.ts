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

/** The notice a user interrupt (bare stop) folds into, so the model's next turn reads that its
 *  previous response was cut off rather than completed. Mirrors the coding-agent convention. */
export const INTERRUPTED_BY_USER = '[Request interrupted by user]';

/** The notice a governed stop folds into, so a resumed conversation reads why the previous
 *  run ended rather than appearing to have stopped for no reason. coa has exactly two blocks
 *  (docs/adr/0028); both surface here. */
export const deniedNotice = (denyKind: string, reason: string): string =>
  `[Stopped by coa: ${denyKind} — ${reason}]`;

/**
 * Fold the append-only event log into the provider-neutral transcript (system omitted)
 * — the read-time projection that replaces the whole-rewrite `messages.json`
 * (docs/adr/0010). Assistant `text`/`tool_use` frames group into one assistant message
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
  const issued = new Set<string>(); // tool_use handles seen so far — the integrity boundary.
  let assistant: BackendMessage | undefined;
  const closeAssistant = (): void => {
    if (assistant !== undefined) {
      // Skip a wholly-empty assistant turn (no text, no tool calls) — matching the
      // retired `messageToBackendMessages`, so the fold stays byte-parity with the old
      // path (D85) and never emits a stray `{ role:'assistant', content:'' }`.
      if (assistant.content !== '' || (assistant.toolCalls?.length ?? 0) > 0) out.push(assistant);
      assistant = undefined;
    }
  };
  for (const { frame, full } of events) {
    switch (frame.t) {
      case 'text':
        if (frame.role === 'user' || frame.role === 'system') {
          // A `system` delivery rides the `user` role live (the Messages API has no
          // other slot for mid-conversation input) — replay must reproduce exactly
          // that, not fold it into the assistant's own text (docs/adr/0010).
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
        issued.add(frame.handle);
        const call: LoopToolCall = { id: frame.handle, name: frame.tool, arguments: frame.input };
        assistant.toolCalls = [...(assistant.toolCalls ?? []), call];
        break;
      }
      case 'tool_result':
        // An orphaned result (no prior tool_use with this handle) answers no assistant
        // tool call; emitting it would invalidate the transcript (an OpenAI-compatible
        // endpoint 400s on a tool message pairing with nothing) — so drop it. Current
        // producers always emit tool_use first, but the fold is the integrity boundary.
        if (!issued.has(frame.handle)) break;
        // A matched result closes the assistant turn that issued the call(s).
        closeAssistant();
        out.push({ role: 'tool', toolCallId: frame.handle, content: full ?? frame.pointer });
        break;
      case 'turn-boundary':
        closeAssistant();
        break;
      case 'interrupted':
        // A user stop: close whatever partial the model got out, then record the notice so the
        // next turn's context shows it was interrupted (SC-1 — a user action, never an error).
        closeAssistant();
        out.push({ role: 'user', content: INTERRUPTED_BY_USER });
        break;
      case 'deny':
        // A governed stop (SC-1's only two blocks): close whatever partial the model got
        // out, then record why — same shape as `interrupted`, since this projection also
        // rebuilds context on resume. A close-gate reason is instructional ("resolve or
        // baseline before finishing") and would otherwise be lost entirely.
        closeAssistant();
        out.push({ role: 'user', content: deniedNotice(frame.denyKind, frame.reason) });
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
        // Delivery-only (docs/adr/0013): the E-seam never appends these to the
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
