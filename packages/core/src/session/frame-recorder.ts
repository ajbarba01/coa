import type { TurnFrame } from '@coa/shared';
import type { Delivery } from '@coa/spi';
import type { ConversationStore } from './conversation-store.js';
import type { LiveSession, StartedHandle } from './live-session.js';

/**
 * The ONE place a turn's frames become visible: pushed to the session's subscribers and
 * appended to the durable log. Every drive strategy records through this module, so the
 * rules that must hold for all of them — deltas are pushed but never persisted, a
 * delivery's line is written where the model actually received it, a settled reasoning
 * block carries its wall-clock — exist once instead of once per strategy.
 *
 * The strategies differ only in WHERE a frame's identity comes from, so exactly two things
 * are injected: the {@link SeqBox} (a per-turn cursor for a fresh turn, a query-lifetime
 * cursor for a held-open query) and the {@link StartedRef} (the handle the backend binds at
 * `onStart`). Two optional hooks carry the rest of the difference: `isInert`, which lets a
 * strategy drop the stragglers of an abandoned turn, and `onSettled`, which lets it count
 * turn boundaries.
 */

/** The persistence target for a turn: the conversation id + its store, or `undefined`
 *  for an ephemeral session (no `conversationId`). */
export interface PersistIn {
  convId: string;
  store: ConversationStore;
}

/** The append-only log's write cursor, boxed so the recorder and the user-prompt append
 *  can share ONE cursor: a held-open query's later turns must not collide with the frames
 *  its earlier turns already wrote. A fresh per-turn turn gets its own box. */
export interface SeqBox {
  value: number;
}

/** The started handle, boxed: a recorder is built before the `onStart` that fills it (and,
 *  for a held-open query, outlives many turns), so it reads the handle through a box rather
 *  than capturing a value that would still be `undefined`. Nothing is written while the box
 *  is empty. */
export interface StartedRef {
  current: StartedHandle | undefined;
}

/**
 * Tracks the in-flight turn's streamed-but-unsettled blocks, so the daemon can (a) stamp a
 * settled `thinking` frame with the wall-clock the model spent reasoning (first→last delta) and
 * (b) SETTLE a partial block itself when a turn is interrupted.
 *
 * Both exist because streaming deltas are delivery-only: only settled frames are
 * persisted. An interrupted turn never emits its settled frame, so without (b) the partial would
 * render live but vanish on reload, and its reasoning block would stream forever. Doing this in
 * the session layer — not per backend — keeps the closure backend-agnostic: every adapter
 * already streams the same delta frames. The token count the reveal shows is derived from the
 * frame text, so it needs no stamping. One per turn / held query; resets after each settled block.
 */
interface StreamAccumulator {
  /** Observe every frame before it is emitted: accumulate deltas, clear a channel the backend settles. */
  observe: (frame: TurnFrame) => void;
  /** Stamp a settled `thinking` frame with its reasoning wall-clock. */
  stamp: (frame: TurnFrame) => TurnFrame;
  /** Take the still-open partial blocks as settled frames (thinking first, then text), clearing them. */
  drainPartials: () => TurnFrame[];
}

function makeStreamAccumulator(): StreamAccumulator {
  let thinking = '';
  let text = '';
  let startMs: number | undefined;
  let endMs: number | undefined;
  const resetClock = (): void => {
    startMs = undefined;
    endMs = undefined;
  };
  return {
    observe: (frame) => {
      if (frame.t === 'thinking-delta') {
        const now = Date.now();
        startMs ??= now;
        endMs = now;
        thinking += frame.text;
      } else if (frame.t === 'text-delta') {
        text += frame.text;
      } else if (frame.t === 'thinking') {
        thinking = ''; // the backend settled this block itself
      } else if (frame.t === 'text') {
        text = '';
      }
    },
    stamp: (frame) => {
      if (frame.t !== 'thinking' || frame.durationMs !== undefined || startMs === undefined)
        return frame;
      const durationMs = (endMs ?? startMs) - startMs;
      resetClock();
      return { ...frame, durationMs };
    },
    drainPartials: () => {
      const out: TurnFrame[] = [];
      if (thinking !== '') {
        const durationMs = startMs !== undefined ? (endMs ?? startMs) - startMs : undefined;
        out.push({
          t: 'thinking',
          text: thinking,
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
        thinking = '';
      }
      if (text !== '') {
        out.push({ t: 'text', text });
        text = '';
      }
      resetClock();
      return out;
    },
  };
}

/**
 * The delivery-legality gate, and its single writer: a delivery drained
 * while a tool call is open cannot be written until that call's result lands, or the line
 * falls between a `tool_use` and its `tool_result` — the one interleaving the Messages API
 * forbids. Living inside the recorder is what keeps it to one writer: every drive strategy
 * reaches it through the same object, so the rule cannot fork.
 *
 * The open-tool count is a COUNT, not a set of handles: a mapped `tool_use` can fall back to
 * an empty handle, so a set of them would collide on two concurrent calls.
 */
interface DeliveryRecorder {
  /** Drain the queue via the caller-supplied `drain`, writing each entry immediately or
   *  parking it behind an open tool call. Returns what was drained, so a caller that also
   *  feeds the text to the model sees every entry regardless of whether it was written or
   *  parked. */
  takeDeliveries: (drain: () => readonly Delivery[]) => readonly Delivery[];
  /** Observe every settled frame: tracks `tool_use`/`tool_result` to keep the open-tool
   *  count current, flushing whatever is parked the moment it returns to zero. */
  noteFrame: (frame: TurnFrame) => void;
  /** Force the gate open and flush. A turn boundary, an interrupt, or the loop ending can
   *  all leave a tool call open forever, and a delivery already handed to the model must
   *  never be lost because nothing else was left to close it. */
  flushAtBoundary: () => void;
}

function createDeliveryRecorder(writeFrame: (delivery: Delivery) => void): DeliveryRecorder {
  let openTools = 0;
  const held: Delivery[] = [];

  function flush(): void {
    for (const delivery of held.splice(0, held.length)) writeFrame(delivery);
  }

  return {
    takeDeliveries: (drain) => {
      const pending = drain();
      for (const delivery of pending) {
        if (openTools > 0) held.push(delivery);
        else writeFrame(delivery);
      }
      return pending;
    },
    noteFrame: (frame) => {
      if (frame.t === 'tool_use') openTools += 1;
      else if (frame.t === 'tool_result') {
        openTools = Math.max(0, openTools - 1);
        if (openTools === 0) flush();
      }
    },
    flushAtBoundary: () => {
      openTools = 0;
      flush();
    },
  };
}

/** Everything a recorder needs, threaded in explicitly — the state a drive strategy shares
 *  with its connection is passed, never reached for. */
export interface FrameRecorderDeps {
  /** The live session the frames are pushed through, and whose delivery queue is drained. */
  session: LiveSession;
  seqBox: SeqBox;
  startedRef: StartedRef;
  persistIn: PersistIn | undefined;
  /**
   * When this reports true, {@link FrameRecorder.record} drops the frame. A held-open query
   * uses it after a user stop: the abandoned turn's partial was already settled and its
   * marker recorded, so its stragglers must not appear BELOW the interrupt marker. A strategy
   * whose turns end with the turn (per-turn) leaves it unset.
   */
  isInert?: () => boolean;
  /** Runs once a settled frame has been written and noted — where a held-open query counts
   *  its `turn-boundary` frames. Never called for a delta (they settle nothing). */
  onSettled?: (frame: TurnFrame) => void;
}

/** The record/emit/persist surface both drive strategies are built on. */
export interface FrameRecorder {
  /** The backend's per-frame hook: accumulate, stamp, push, persist, and note the frame
   *  against the delivery gate. */
  record: (frame: TurnFrame, full?: string) => void;
  /** Push AND persist one already-settled frame at the next `seq`, skipping the accumulator
   *  and the delivery gate — for a line the recorder itself did not receive from the backend
   *  (a steer being fed as a turn, a settlement's error frame). */
  writeFrame: (frame: TurnFrame, full?: string) => void;
  /** The backend's delivery drain: hands back everything drained (so a caller can also feed
   *  it to the model) while writing each line where the model received it. */
  takeDeliveries: () => readonly Delivery[];
  /** Write whatever is parked behind a tool call that will never close. */
  flushDeliveries: () => void;
  /** The shared user-stop settlement: settle the streamed partial so it PERSISTS (deltas
   *  never do, so without this it renders live and vanishes on reload), flush a parked
   *  delivery, then record the interrupt marker — which is also how the model learns next
   *  turn that it was cut off. */
  settleInterrupt: () => void;
}

export function createFrameRecorder(rec: FrameRecorderDeps): FrameRecorder {
  const { session, seqBox, startedRef, persistIn } = rec;
  const acc = makeStreamAccumulator();

  /** Take the next `seq` and push the frame under it, returning the number so the caller can
   *  persist under the same one — the pushed and stored orders are identical by construction. */
  function emitAt(started: StartedHandle, frame: TurnFrame): number {
    const seq = seqBox.value++;
    session.emit({ kind: 'turn', sessionId: started.id, worktree: started.worktree, seq, frame });
    return seq;
  }

  function writeFrame(frame: TurnFrame, full?: string): void {
    const started = startedRef.current;
    if (started === undefined) return;
    const seq = emitAt(started, frame);
    if (persistIn !== undefined)
      persistIn.store.append(persistIn.convId, [
        { seq, frame, ...(full !== undefined ? { full } : {}) },
      ]);
  }

  // A delivery's line is a plain user turn in the log — a `system` one is marked as such so
  // the model cannot read an automated report as the person speaking.
  const deliveries = createDeliveryRecorder((delivery) =>
    writeFrame({
      t: 'text',
      text: delivery.text,
      role: delivery.origin === 'system' ? 'system' : 'user',
    }),
  );

  // `full`, present on a `tool_result`, is the complete body the model saw — pushed to the
  // connection ONLY as `frame` (never on the wire); persisted alongside it.
  function record(frame: TurnFrame, full?: string): void {
    if (startedRef.current === undefined) return;
    if (rec.isInert?.() === true) return;
    acc.observe(frame);
    // Streaming deltas are delivery-only: push for live render, but NEVER persist and never
    // reach the settled-frame bookkeeping below — the append-only log holds only settled
    // frames, so the read-time fold and cross-turn memory are unchanged.
    if (frame.t === 'text-delta' || frame.t === 'thinking-delta') {
      emitAt(startedRef.current, frame);
      return;
    }
    // A settled `thinking` frame is stamped with the reasoning wall-clock (persisted so a
    // reload shows "Thought for Ns" identically); every other frame passes through unchanged.
    writeFrame(acc.stamp(frame), full);
    deliveries.noteFrame(frame);
    rec.onSettled?.(frame);
  }

  return {
    record,
    writeFrame,
    takeDeliveries: () => deliveries.takeDeliveries(() => session.deliveries.drain()),
    flushDeliveries: deliveries.flushAtBoundary,
    settleInterrupt: () => {
      for (const partial of acc.drainPartials()) record(partial);
      deliveries.flushAtBoundary();
      record({ t: 'interrupted' });
    },
  };
}
