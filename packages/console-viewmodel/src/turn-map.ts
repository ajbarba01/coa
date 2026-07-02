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
 * view's, so lifecycle-only frames (turn-boundary/subagent/reconcile) and the
 * bare `permission` frame are dropped here; `cost`/`status` pushes are not turns
 * and the shell handles them separately. This is the console edge — the sole place
 * the M0 shape is translated — so the renderer works only in view types.
 *
 * Floor notes (deferred with the R-7 store): a `tool_result` frame carries only a
 * `handle`, so its `tool` label is empty until handle→tool correlation lands;
 * `thinking`/`error` render as agent text lines (the view has no dedicated kind);
 * live approvals ride the deferred deny/approval push channel.
 */
export function pushToViewFrames(push: Push): TurnFrame[] {
  if (push.kind !== 'turn') return [];
  const id = `${push.sessionId}:${push.seq}`;
  const frame = mapFrame(push.frame, id);
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

function mapFrame(frame: WireTurnFrame, id: string): TurnFrame | undefined {
  switch (frame.t) {
    case 'text':
      return { id, role: frame.role === 'user' ? 'you' : 'agent', kind: 'text', text: frame.text };
    case 'thinking':
      return { id, role: 'agent', kind: 'text', text: frame.text };
    case 'error':
      return { id, role: 'agent', kind: 'text', text: `⚠ ${frame.message}` };
    case 'tool_use':
      return { id, role: 'agent', kind: 'tool-use', tool: frame.tool, input: JSON.stringify(frame.input) };
    case 'tool_result':
      return { id, role: 'agent', kind: 'tool-result', tool: '', output: frame.pointer, ok: frame.ok };
    default:
      return undefined;
  }
}
