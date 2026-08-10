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
    if (isStreamingChannel(f) && f.kind === kind && f.role === role && f.streaming === true)
      return i;
  }
  return -1;
}

/** Last block of this channel regardless of `streaming`, or -1. Used to still replace a
 *  reasoning block whose `streaming` flag was cleared early (settleOpenThinking) when its
 *  message-end settled frame finally arrives — otherwise it would append a duplicate. */
function lastBlockIndex(turns: readonly TurnFrame[], kind: TextKind, role: string): number {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const f = turns[i]!;
    if (isStreamingChannel(f) && f.kind === kind && f.role === role) return i;
  }
  return -1;
}

/** When agent output text begins, any still-open reasoning block is done — clear its
 *  `streaming` flag so the reasoning card's auto-collapse fires now, rather than waiting for
 *  the message-end settled `thinking` frame (which the backend emits together with the
 *  settled text, so the flag would otherwise stay set through the whole output). */
function settleOpenThinking(turns: readonly TurnFrame[]): readonly TurnFrame[] {
  if (!turns.some((t) => t.kind === 'thinking' && t.streaming === true)) return turns;
  return turns.map((t) =>
    t.kind === 'thinking' && t.streaming === true ? { ...t, streaming: false } : t,
  );
}

/** Fold one incoming frame into the turn list with streaming reconciliation. */
export function appendStreamingFrame(turns: readonly TurnFrame[], frame: TurnFrame): TurnFrame[] {
  // Agent/subagent output text ends the reasoning phase (see settleOpenThinking).
  const base = frame.kind === 'text' && frame.role !== 'you' ? settleOpenThinking(turns) : turns;
  if (!isStreamingChannel(frame)) return [...base, frame];

  const openIdx = openBlockIndex(base, frame.kind, frame.role);

  if (frame.streaming === true) {
    // Accumulate the chunk into the open block of this channel, or open a new one.
    if (openIdx === -1) return [...base, frame];
    const open = base[openIdx] as Extract<TurnFrame, { kind: TextKind }>;
    const merged = { ...open, text: open.text + frame.text };
    return [...base.slice(0, openIdx), merged, ...base.slice(openIdx + 1)];
  }

  // A settled block replaces the open streaming block of its channel (keeping the id so the
  // row does not remount).
  if (openIdx !== -1) {
    const open = base[openIdx] as Extract<TurnFrame, { kind: TextKind }>;
    return [...base.slice(0, openIdx), { ...frame, id: open.id }, ...base.slice(openIdx + 1)];
  }
  // A settled thinking frame whose live block was already closed early (settleOpenThinking)
  // replaces that block rather than duplicating it. Other settled frames with no open block
  // append (pass-through floor / reloaded log — non-streaming backends and reload never carry deltas).
  if (frame.kind === 'thinking') {
    const lastIdx = lastBlockIndex(base, 'thinking', frame.role);
    if (lastIdx !== -1) {
      const prev = base[lastIdx]!;
      return [...base.slice(0, lastIdx), { ...frame, id: prev.id }, ...base.slice(lastIdx + 1)];
    }
  }
  return [...base, frame];
}

/** Fold a batch of incoming frames into the turn list, in order. */
export function reconcileStreaming(
  turns: readonly TurnFrame[],
  incoming: readonly TurnFrame[],
): TurnFrame[] {
  return incoming.reduce<TurnFrame[]>((acc, f) => appendStreamingFrame(acc, f), [...turns]);
}
