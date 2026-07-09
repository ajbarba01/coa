import type { TurnFrame } from './reads.js';

/**
 * Streaming reconciliation (Piece B / G7). Streaming delta frames (`streaming: true`,
 * mapped from `text-delta`/`thinking-delta`) are delivery-only: the shell folds each into
 * the live block of its channel, and the settled `text`/`thinking` frame that follows
 * REPLACES that block — so the transcript shows text growing live, then snaps to the
 * canonical block with no double-render. The settled block inherits the live block's `id`
 * so React keeps the row mounted across the swap. Non-streaming frames pass through
 * unchanged (a non-streaming backend and the reloaded durable log never carry deltas).
 */

/** Text-bearing view kinds a streaming delta can target. */
type TextKind = 'text' | 'thinking';

function isStreamingChannel(
  frame: TurnFrame,
): frame is Extract<TurnFrame, { kind: TextKind; role: 'you' | 'agent' | 'subagent' }> {
  return frame.kind === 'text' || frame.kind === 'thinking';
}

/** Index of the still-open streaming block of this channel (kind + role), or -1. Searched
 *  from the end but tolerant of a non-adjacent block: a settled `thinking` frame arrives
 *  AFTER the streaming `text` block has opened, so the open thinking block is not last. */
function openBlockIndex(turns: readonly TurnFrame[], kind: TextKind, role: string): number {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const f = turns[i]!;
    if (isStreamingChannel(f) && f.kind === kind && f.role === role && f.streaming === true) return i;
  }
  return -1;
}

/** Fold one incoming frame into the turn list with streaming reconciliation. */
export function appendStreamingFrame(turns: readonly TurnFrame[], frame: TurnFrame): TurnFrame[] {
  if (!isStreamingChannel(frame)) return [...turns, frame];

  const openIdx = openBlockIndex(turns, frame.kind, frame.role);

  if (frame.streaming === true) {
    // Accumulate the chunk into the open block of this channel, or open a new one.
    if (openIdx === -1) return [...turns, frame];
    const open = turns[openIdx] as Extract<TurnFrame, { kind: TextKind }>;
    const merged = { ...open, text: open.text + frame.text };
    return [...turns.slice(0, openIdx), merged, ...turns.slice(openIdx + 1)];
  }

  // A settled block replaces the open streaming block of its channel (keeping the id so the
  // row does not remount), or appends when there was no streaming (D85 / reloaded log).
  if (openIdx === -1) return [...turns, frame];
  const open = turns[openIdx] as Extract<TurnFrame, { kind: TextKind }>;
  return [...turns.slice(0, openIdx), { ...frame, id: open.id }, ...turns.slice(openIdx + 1)];
}

/** Fold a batch of incoming frames into the turn list, in order. */
export function reconcileStreaming(
  turns: readonly TurnFrame[],
  incoming: readonly TurnFrame[],
): TurnFrame[] {
  return incoming.reduce<TurnFrame[]>((acc, f) => appendStreamingFrame(acc, f), [...turns]);
}
