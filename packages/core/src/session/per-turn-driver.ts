import type { ConversationStore } from './conversation-store.js';
import { createFrameRecorder, type SeqBox, type StartedRef } from './frame-recorder.js';
import type { LiveSession, QueuedTurn } from './live-session.js';
import { describeLoopFailure } from './loop-failure.js';
import { createSession } from './session.js';
import { composeTurnInput } from './skill-invocation.js';
import { attachSubscriber, emitUsage, type TurnDriverDeps } from './turn-driver.js';
import { TurnLifecycle } from './turn-lifecycle.js';
import { buildPersistenceHooks, prepareTurnPersistence } from './turn-persistence.js';

/**
 * The per-turn drive strategy: one session-creation call per turn, awaited to completion.
 * Every pure-API backend runs this way — a fresh adapter, a one-shot string prompt, and a
 * loop that ends when the turn does. The neutral user-stop lives on the session's control
 * state; a steer lands on the session's delivery queue, which this turn's own drain hook
 * reaches at its next round trip.
 *
 * Because the turn and the run are the same thing here, the recorder gets a cursor and a
 * start handle that are born and die with it — the held-open strategy is the same code with
 * query-lifetime ones instead.
 */
export async function runPerTurn(
  ctx: TurnDriverDeps,
  turn: QueuedTurn,
  session: LiveSession,
  persistentStore: ConversationStore | undefined,
): Promise<void> {
  const seqBox: SeqBox = { value: 0 };
  const prep = prepareTurnPersistence(turn, session, turn.role ?? '', persistentStore, seqBox);
  const startedRef: StartedRef = { current: undefined };
  const recorder = createFrameRecorder({
    session,
    seqBox,
    startedRef,
    persistIn: prep.persistIn,
  });
  const controller = new AbortController();
  // The turn and the run are the same thing here, so one lifecycle spans both. The
  // session control carries this very instance, which is how the interrupt verb and this
  // settlement read ONE state instead of a flag each.
  const lifecycle = new TurnLifecycle();

  try {
    await createSession(
      {
        role: prep.role,
        ...(turn.roles !== undefined ? { roles: turn.roles } : {}),
        scope: turn.scope ?? '',
        // Invoked skill payloads ride above the user's text (skill-invocation.ts);
        // the prelude persisted the same blocks as their own `system` frames.
        input: composeTurnInput(turn),
        ...(turn.attachments !== undefined ? { attachments: turn.attachments } : {}),
        ...(turn.visionSupported !== undefined ? { visionSupported: turn.visionSupported } : {}),
        ...(turn.model ? { model: turn.model } : {}),
        ...(turn.packageIds !== undefined ? { packageIds: turn.packageIds } : {}),
        ...(turn.exclude !== undefined ? { exclude: turn.exclude } : {}),
        ...(turn.skillPieces !== undefined ? { skills: turn.skillPieces } : {}),
        ...(turn.mcpServers !== undefined ? { mcpServers: turn.mcpServers } : {}),
        ...(turn.isolate !== undefined ? { isolate: turn.isolate } : {}),
        sessionId: session.id,
        // A root session's own spend carries no `root` (byte-identical to
        // before lineage existed); a spawned child's does, tagged with its
        // top-of-tree ancestor regardless of nesting depth (`session.root` already
        // walks that far — see `startChild`).
        ...(session.parent !== undefined ? { root: session.root } : {}),
        ...buildPersistenceHooks(prep),
        signal: controller.signal,
        drainDeliveries: recorder.takeDeliveries,
        onUsage: (usage) => emitUsage(session, usage),
        onStart: (s) => {
          startedRef.current = s;
          session.control = {
            controller,
            lifecycle,
            mode: 'per-turn',
          };
          // A user stop settles whatever the model streamed (so it persists and a reload reads
          // the same transcript), records the interrupt marker, THEN aborts the loop. Settling
          // before the abort is what keeps the partial from being lost — deltas are never
          // persisted, so only this settled frame reaches the durable log.
          //
          // The lifecycle is closed here too, but be honest about what that does and does not
          // buy: unlike the held-open strategy, NOTHING observable depends on this ordering
          // today. Held-open hands the recorder an inert gate keyed to the stopped phase, so
          // closing before settling there would drop the interrupt marker itself; this driver
          // supplies no such gate, because aborting unwinds the loop and leaves no query
          // behind to emit stragglers into — that survival is exactly what held-open has and
          // this does not. So the close keeps the phase honest for anything that later reads
          // it, and no test can pin the order until something observable depends on it.
          session.setInterruptClosure(() => {
            recorder.settleInterrupt();
            lifecycle.closeStop();
            controller.abort();
            return true;
          });
          session.setState('running', s.worktree);
          // Turn activity resets the idle-eviction clock — belt-and-braces alongside the
          // running-aware idle timer in live-registry.ts.
          ctx.registry.touch(session.id);
          // Hydration reflects the true first status ('running') — this fires AFTER setState.
          attachSubscriber(session, turn);
          turn.onReady?.(s);
        },
        onTurn: recorder.record,
      },
      ctx.deps,
    );
    // The loop is over; anything still parked behind a tool that never returned its result
    // was still handed to the model, so it is written rather than lost.
    recorder.flushDeliveries();
    // A pure-API backend aborted at the loop's top-of-iteration boundary settles
    // cleanly (no throw) — so a completed interrupt is seen here, not in `catch`.
    const stoppedByUser = lifecycle.stoppedByUser;
    lifecycle.settle();
    session.control = undefined;
    session.setInterruptClosure(undefined);
    // `interruptSession` already emitted `'interrupted'` synchronously — this
    // clean-break settle must not emit it again. Only a genuine completion emits `'done'`.
    if (stoppedByUser) return;
    if (startedRef.current !== undefined)
      ctx.emitStatus(session, startedRef.current.worktree, 'done');
  } catch (err) {
    // A mid-turn throw (most often a dropped provider connection) leaves the backend
    // session id captured but this turn's transcript unsaved — a resume on the next
    // send would replay a phantom server session. Drop the token so the next send
    // replays the last-good transcript instead (fail-safe, not resume).
    if (prep.persistIn !== undefined)
      prep.persistIn.store.clearBackendSession(prep.persistIn.convId);
    const stoppedByUser = lifecycle.stoppedByUser;
    lifecycle.settle();
    session.control = undefined;
    session.setInterruptClosure(undefined);
    // an interrupt is a user stop, not a governance block; `interruptSession`
    // already emitted `'interrupted'`. Nothing further to surface.
    if (stoppedByUser) return;
    // A genuine mid-turn throw reaches neither the interrupt closure nor the `try` block's
    // own post-await flush — so anything parked behind a still-open tool call is flushed
    // here, BEFORE the error frame below, so the log shows the delivery where the model
    // actually read it, above the failure that followed it.
    recorder.flushDeliveries();
    const message = describeLoopFailure(err);
    if (startedRef.current !== undefined) {
      recorder.record({ t: 'error', message, origin: 'loop' });
      ctx.emitStatus(session, startedRef.current.worktree, 'error', message);
    }
  }
}
