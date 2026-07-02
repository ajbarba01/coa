import type { Push, TurnFrame as WireTurnFrame } from '@coa/shared';
import type { TurnFrame } from './reads.js';

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

function mapFrame(frame: WireTurnFrame, id: string): TurnFrame | undefined {
  switch (frame.t) {
    case 'text':
      return { id, role: 'agent', kind: 'text', text: frame.text };
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
