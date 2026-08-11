import { z } from 'zod';
import {
  turnFrameSchema,
  type Banner,
  type Push,
  type TurnFrame as WireTurnFrame,
} from '@coa/shared';
import type { TurnFrame } from './reads.js';

/** A persisted turn as `reloadConversation` returns it from the turn store: the wire frame + its seq. */
export const persistedTurnSchema = z.object({ seq: z.number(), frame: turnFrameSchema });
export const persistedTurnsSchema = z.array(persistedTurnSchema);
export type PersistedTurnWire = z.infer<typeof persistedTurnSchema>;

/** A reloaded conversation as the turn store returns it today: the readable turns plus
 *  the count of stored events too corrupt to read. */
const reloadedObjectSchema = z.object({
  turns: persistedTurnsSchema,
  skipped: z.number().default(0),
});

/**
 * The reply shape, accepting BOTH the object above and the bare turns ARRAY a daemon
 * that predates the count answers with — normalized to a conversation that lost nothing.
 *
 * The tolerance has to be a real alternative, not a default: a default only fills a
 * missing key INSIDE an object, and an object schema rejects an array outright. The
 * console strictly parses every reply, so without this an older daemon behind a newer
 * console fails every conversation open with a load error — which is a version skew a
 * stale build reaches in practice, not a hypothetical.
 */
export const reloadedConversationSchema = z.union([
  reloadedObjectSchema,
  persistedTurnsSchema.transform((turns) => ({ turns, skipped: 0 })),
]);
export type ReloadedConversationWire = z.infer<typeof reloadedObjectSchema>;

/**
 * Map a reloaded conversation (persisted wire frames from the turn store) to the view `TurnFrame`s the
 * transcript renders — the durable analog of {@link pushToViewFrames}. Reuses the same
 * per-frame translation AND the same id scheme: the daemon pushes and persists a frame
 * under one shared seq (the pushed and stored orders are identical by construction), so a
 * reloaded frame carries the exact id its live push carried. That shared identity is what
 * lets a rehydration merge dedupe live-vs-reloaded frames by id, and keeps a React row
 * mounted across a resubscribe instead of remounting the whole transcript.
 *
 * When the store could not read part of the log, the transcript ends with a system
 * notice saying so. Rendering the readable remainder on its own would present a
 * fragment as the complete record — the reader has no other way to tell the difference,
 * since missing turns leave no gap to see.
 */
export function reloadToViewFrames(
  reloaded: ReloadedConversationWire,
  sessionId: string,
): TurnFrame[] {
  const frames = reloaded.turns.flatMap((t) => {
    const frame = mapFrame(t.frame, `${sessionId}:${t.seq}`);
    return frame === undefined ? [] : [frame];
  });
  if (reloaded.skipped > 0) frames.push(skippedNotice(reloaded.skipped));
  return frames;
}

/** The transcript's own admission that it is incomplete — a system notice, the lane
 *  coa's own statements use, never something attributed to the model. */
function skippedNotice(skipped: number): TurnFrame {
  const events = skipped === 1 ? '1 unreadable event' : `${skipped} unreadable events`;
  return {
    id: 'reload:skipped',
    role: 'system',
    kind: 'text',
    text: `${events} skipped — part of this session's record could not be read, so what is shown above is incomplete.`,
  };
}

/**
 * The daemon→console turn mapping: one pushed turn record → the console `TurnFrame`s
 * the transcript renders. The wire vocabulary (the shared `push.ts`) is richer than the
 * view's, so lifecycle-only frames (turn-boundary/reconcile) and the
 * bare `permission` frame are dropped here; `cost`/`status` pushes are not turns
 * and the shell handles them separately. This is the console edge — the sole place
 * the wire shape is translated — so the renderer works only in view types.
 *
 * Floor notes (deferred with the turn store): a `tool_result` frame carries only a
 * `handle`, so its `tool` label is empty until handle→tool correlation lands;
 * live approvals ride the deferred deny/approval push channel. Now maps `thinking`,
 * `error`, `subagent`, and `plan` (TodoWrite) frames to their dedicated kinds.
 */
export function pushToViewFrames(push: Push): TurnFrame[] {
  if (push.kind !== 'turn') return [];
  // A live-only turn (`push.live`) is numbered in its own space, not the durable log's —
  // its seq 0 and the log's seq 0 are different turns. Namespacing the id keeps the two
  // from ever naming the same row, and marks the frame as one no reload will ever
  // restate, which is what the transcript's reload merge needs to know about it.
  const id =
    push.live === true ? `live:${push.sessionId}:${push.seq}` : `${push.sessionId}:${push.seq}`;
  const depth = push.parentTurn ? 1 : undefined;
  const frame = mapFrame(push.frame, id, depth);
  return frame === undefined ? [] : [frame];
}

/**
 * The push→banner edge: a `banner` push yields its descriptor; any other push yields
 * undefined. A banner is a SYSTEM-only chat notice (never a transcript turn), so it is
 * routed here rather than through {@link pushToViewFrames}. The wire {@link Banner} shape
 * is already view-ready, so this is the single validated seam, not a reshape.
 */
export function pushToBanner(push: Push): Banner | undefined {
  return push.kind === 'banner' ? push.banner : undefined;
}

const TODO_STATUS: Record<string, 'pending' | 'in-progress' | 'done'> = {
  pending: 'pending',
  in_progress: 'in-progress',
  completed: 'done',
};

function mapFrame(frame: WireTurnFrame, id: string, depth?: number): TurnFrame | undefined {
  const d = depth === undefined ? {} : { depth };
  switch (frame.t) {
    case 'text': {
      // `user` is the person, `system` is a coa-authored notice (a child session's
      // ending, e.g.) — neither the person nor the agent's own claim, so it gets its
      // own lane rather than collapsing into `agent` (a system fact must not read
      // as something the model said). Anything else is the assistant.
      const role = frame.role === 'user' ? 'you' : frame.role === 'system' ? 'system' : 'agent';
      return { id, role, kind: 'text', text: frame.text, ...d };
    }
    case 'text-delta':
      // A streaming chunk (Piece B): the shell accumulates it into the live agent block,
      // then the settled `text` frame replaces it (deltas are delivery-only, never persisted).
      return { id, role: 'agent', kind: 'text', text: frame.text, streaming: true, ...d };
    case 'thinking-delta':
      return { id, role: 'agent', kind: 'thinking', text: frame.text, streaming: true, ...d };
    case 'thinking':
      // Opus often emits blank/redacted thinking — an empty expander is dishonest UI,
      // so drop the frame entirely rather than render nothing to expand.
      return frame.text.trim().length === 0
        ? undefined
        : {
            id,
            role: 'agent',
            kind: 'thinking',
            text: frame.text,
            ...(frame.durationMs !== undefined ? { durationMs: frame.durationMs } : {}),
            ...d,
          };
    case 'error':
      return {
        id,
        role: 'agent',
        kind: 'error',
        message: frame.message,
        origin: frame.origin,
        ...d,
      };
    case 'deny':
      // A governed stop, not a fault — the transcript draws it as a DenyNotice rather
      // than an error bubble (a firm stop with a reason, not an alarm). Carries no `depth`: a block is the session's, not
      // a nested turn's.
      return { id, kind: 'deny', denyKind: frame.denyKind, reason: frame.reason };
    case 'tool_use':
      if (frame.tool === 'TodoWrite')
        return { id, role: 'agent', kind: 'plan', items: toPlanItems(frame.input), ...d };
      return {
        id,
        role: 'agent',
        kind: 'tool-use',
        tool: frame.tool,
        input: JSON.stringify(frame.input),
        handle: frame.handle,
        ...d,
      };
    case 'tool_result':
      return {
        id,
        role: 'agent',
        kind: 'tool-result',
        tool: '',
        output: frame.pointer,
        ok: frame.ok,
        handle: frame.handle,
        ...d,
      };
    case 'subagent':
      return { id, kind: 'subagent', childWorktree: frame.childWorktree, event: frame.event, ...d };
    // The three live-only subagent announcements pass through field-for-field: the
    // wire shape is already view-ready, and each renders as its own dedicated card
    // (spawn / completion / agent-to-agent message). Live-only means a reload never
    // replays one — `reloadToViewFrames` simply never sees these kinds.
    case 'subagent-spawn':
      return {
        id,
        kind: 'subagent-spawn',
        childSessionId: frame.childSessionId,
        childWorktree: frame.childWorktree,
        agentRef: frame.agentRef,
        description: frame.description,
        isolate: frame.isolate,
        ...d,
      };
    case 'subagent-completion':
      return {
        id,
        kind: 'subagent-completion',
        childSessionId: frame.childSessionId,
        childWorktree: frame.childWorktree,
        agentRef: frame.agentRef,
        reason: frame.reason,
        ...(frame.detail !== undefined ? { detail: frame.detail } : {}),
        ...(frame.result !== undefined ? { result: frame.result } : {}),
        ...d,
      };
    case 'subagent-message':
      return {
        id,
        kind: 'subagent-message',
        messageId: frame.messageId,
        threadId: frame.threadId,
        ...(frame.replyTo !== undefined ? { replyTo: frame.replyTo } : {}),
        from: frame.from,
        to: frame.to,
        direction: frame.direction,
        body: frame.body,
        ...d,
      };
    case 'interrupted':
      return { id, kind: 'interrupted' };
    default:
      return undefined; // turn-boundary, reconcile, permission — deferred/handled elsewhere
  }
}

function toPlanItems(
  input: Record<string, unknown>,
): { text: string; status: 'pending' | 'in-progress' | 'done' }[] {
  const todos = Array.isArray((input as { todos?: unknown }).todos)
    ? (input as { todos: unknown[] }).todos
    : [];
  return todos.flatMap((t) => {
    if (typeof t !== 'object' || t === null) return [];
    const { content, status } = t as { content?: unknown; status?: unknown };
    if (typeof content !== 'string') return [];
    return [{ text: content, status: TODO_STATUS[String(status)] ?? 'pending' }];
  });
}
