import { z } from 'zod';
import {
  turnFrameSchema,
  type Banner,
  type Push,
  type TurnFrame as WireTurnFrame,
} from '@coa/shared';
import type { TurnFrame } from './reads.js';

/** A persisted turn as `reloadConversation` returns it (R-7): the M0 frame + its seq. */
export const persistedTurnSchema = z.object({ seq: z.number(), frame: turnFrameSchema });
export const persistedTurnsSchema = z.array(persistedTurnSchema);
export type PersistedTurnWire = z.infer<typeof persistedTurnSchema>;

/**
 * Map a reloaded R-7 conversation (persisted M0 frames) to the view `TurnFrame`s the
 * transcript renders — the durable analog of {@link pushToViewFrames}. Reuses the same
 * per-frame translation, so a reopened session reads identically to the live stream.
 */
export function reloadToViewFrames(turns: PersistedTurnWire[]): TurnFrame[] {
  return turns.flatMap((t) => {
    const frame = mapFrame(t.frame, `t${t.seq}`);
    return frame === undefined ? [] : [frame];
  });
}

/**
 * The daemon→console turn mapping: one CON-PUSH record → the console `TurnFrame`s
 * the transcript renders. The wire vocabulary (M0 `push.ts`) is richer than the
 * view's, so lifecycle-only frames (turn-boundary/reconcile) and the
 * bare `permission` frame are dropped here; `cost`/`status` pushes are not turns
 * and the shell handles them separately. This is the console edge — the sole place
 * the M0 shape is translated — so the renderer works only in view types.
 *
 * Floor notes (deferred with the R-7 store): a `tool_result` frame carries only a
 * `handle`, so its `tool` label is empty until handle→tool correlation lands;
 * live approvals ride the deferred deny/approval push channel. Now maps `thinking`,
 * `error`, `subagent`, and `plan` (TodoWrite) frames to their dedicated kinds.
 */
export function pushToViewFrames(push: Push): TurnFrame[] {
  if (push.kind !== 'turn') return [];
  const id = `${push.sessionId}:${push.seq}`;
  const depth = push.parentTurn ? 1 : undefined;
  const frame = mapFrame(push.frame, id, depth);
  return frame === undefined ? [] : [frame];
}

/**
 * The push→banner edge: a `banner` push yields its descriptor; any other push yields
 * undefined. A banner is a SYSTEM-only chat notice (never a transcript turn), so it is
 * routed here rather than through {@link pushToViewFrames}. The M0 {@link Banner} shape
 * is already view-ready, so this is the single validated seam, not a reshape.
 */
export function pushToBanner(push: Push): Banner | undefined {
  return push.kind === 'banner' ? push.banner : undefined;
}

const TODO_STATUS: Record<string, 'pending' | 'in-progress' | 'done'> = {
  pending: 'pending', in_progress: 'in-progress', completed: 'done',
};

function mapFrame(frame: WireTurnFrame, id: string, depth?: number): TurnFrame | undefined {
  const d = depth === undefined ? {} : { depth };
  switch (frame.t) {
    case 'text':
      return { id, role: frame.role === 'user' ? 'you' : 'agent', kind: 'text', text: frame.text, ...d };
    case 'text-delta':
      // A streaming chunk (Piece B): the shell accumulates it into the live agent block,
      // then the settled `text` frame replaces it (docs/adr/0013).
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
      return { id, role: 'agent', kind: 'error', message: frame.message, origin: frame.origin, ...d };
    case 'tool_use':
      if (frame.tool === 'TodoWrite') return { id, role: 'agent', kind: 'plan', items: toPlanItems(frame.input), ...d };
      return { id, role: 'agent', kind: 'tool-use', tool: frame.tool, input: JSON.stringify(frame.input), handle: frame.handle, ...d };
    case 'tool_result':
      return { id, role: 'agent', kind: 'tool-result', tool: '', output: frame.pointer, ok: frame.ok, handle: frame.handle, ...d };
    case 'subagent':
      return { id, kind: 'subagent', childWorktree: frame.childWorktree, event: frame.event, ...d };
    case 'interrupted':
      return { id, kind: 'interrupted' };
    default:
      return undefined; // turn-boundary, reconcile, permission — deferred/handled elsewhere
  }
}

function toPlanItems(input: Record<string, unknown>): { text: string; status: 'pending' | 'in-progress' | 'done' }[] {
  const todos = Array.isArray((input as { todos?: unknown }).todos) ? (input as { todos: unknown[] }).todos : [];
  return todos.flatMap((t) => {
    if (typeof t !== 'object' || t === null) return [];
    const { content, status } = t as { content?: unknown; status?: unknown };
    if (typeof content !== 'string') return [];
    return [{ text: content, status: TODO_STATUS[String(status)] ?? 'pending' }];
  });
}
