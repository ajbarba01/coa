import type { TurnInterrupt } from '@coa/spi';
import type { ConversationStore } from './conversation-store.js';
import {
  createFrameRecorder,
  type FrameRecorder,
  type PersistIn,
  type SeqBox,
  type StartedRef,
} from './frame-recorder.js';
import { InputChannel } from './input-channel.js';
import type { LiveSession, QueuedTurn } from './live-session.js';
import { describeLoopFailure } from './loop-failure.js';
import { createSession } from './session.js';
import { attachSubscriber, type TurnDriverDeps } from './turn-driver.js';
import { TurnLifecycle } from './turn-lifecycle.js';
import { buildPersistenceHooks, prepareTurnPersistence } from './turn-persistence.js';

/**
 * The held-open drive strategy (docs/adr/0012): ONE session-creation call stays open across
 * every turn of a conversation, fed its successive user turns through a derived
 * {@link InputChannel}. The backend's own loop is never restarted, so the model keeps its
 * live context and a turn-level interrupt can stop the CURRENT turn without killing the
 * conversation.
 *
 * That is the whole reason this file is not just `per-turn-driver.ts` with a flag. Because
 * the run outlives the turn, three things the per-turn strategy gets for free have to be
 * managed here: a shared `seq` cursor and start handle that span the query's whole life, a
 * count of pushed-but-not-yet-finished turns (so the driver parks until the RIGHT boundary),
 * and a settlement that can fire long after the turn that provoked it.
 */

/** Prefix marking a `system`-origin delivery flushed as a plain turn, so the model reads a
 *  platform notice rather than the person speaking. Mirrors what every backend renders for
 *  a `system` delivery it drains mid-loop; a `user` delivery is fed bare,
 *  matching the text already written to the log when it was queued. */
const FRAME_SYSTEM_NOTICE = '[coa notice] ';

/** Gated stop tracing (off by default). Set `COA_DEBUG_STEER=1` to log a bare stop's
 *  boundary/`pendingTurns` transitions on a live run — the one piece of the interrupt
 *  lifecycle that only a real streaming backend can reveal (does an interrupted turn
 *  boundary, and in what order relative to the interrupt ack). Written to stderr so it never
 *  pollutes the newline-delimited RPC channel on stdout. */
const DEBUG_STEER = process.env['COA_DEBUG_STEER'] === '1';
function dbgSteer(event: string, detail: Record<string, unknown>): void {
  if (DEBUG_STEER) console.error(`[coa steer] ${event}`, JSON.stringify(detail));
}

/**
 * A single held-open query: its derived input feed, the current turn's boundary latch, the
 * persistence target, and the long-lived session promise. `close` ends the feed so the query
 * terminates after the last result; its `lifecycle` settling is what marks it spent.
 */
interface HeldQuery {
  configKey: string;
  channel: InputChannel;
  persistIn: PersistIn | undefined;
  /** The in-flight turn's completion latch — resolved on its `turn-boundary` frame
   *  (or when the query settles). `undefined` between turns. */
  boundary: Deferred | undefined;
  /** How many pushed-but-not-yet-boundaried turns are outstanding on this query (initial +
   *  continue). The driver's `boundary` latch resolves only when this returns to 0. */
  pendingTurns: number;
  /** This backend's turn-level interrupt (reported up via `onTurnInterrupt`), used by a
   *  bare stop (`interruptSession`) to stop the current turn while keeping the query alive. */
  turnInterrupt: TurnInterrupt | undefined;
  /** Where this query's CURRENT turn stands — the one state the recorder, the interrupt
   *  closure, the settlement, and `session.control` all read (the same instance is on the
   *  control). A bare stop leaves it `stopped`, which is what makes the abandoned turn's
   *  stragglers inert; the next turn re-arms it, because the query outlives the stop. */
  lifecycle: TurnLifecycle;
  close: () => void;
  /** This query's frame recorder. `settleHeldQuery` closes over nothing, so it reaches the
   *  recorder through the query it already receives, the same way `close` does — a mid-turn
   *  throw must flush a parked delivery line exactly like a turn boundary or an interrupt
   *  already does (docs/adr/0031). */
  recorder: FrameRecorder;
  done: Promise<void>;
}

/** A minimal resolve-only latch — one per held-open turn, awaited by the driver and
 *  resolved from the turn-boundary frame (or query settlement). */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * The identity of a held-open query's prompt-shaping config + model. A later turn
 * whose key differs (a mid-conversation model/role/scope switch) cannot ride the open
 * query — the prompt/model were fixed when it was created — so the driver re-establishes.
 * The model IS part of the key (unlike the drift hash), since the held query pinned it.
 */
function configKeyOf(turn: QueuedTurn): string {
  return JSON.stringify({
    provider: turn.model?.provider ?? 'claude',
    model: turn.model?.model ?? null,
    reasoning: turn.model?.reasoning ?? null,
    role: turn.role ?? '',
    roles: turn.roles ? [...turn.roles].sort() : null,
    packageIds: turn.packageIds ?? null,
    exclude: turn.exclude ?? null,
    scope: turn.scope ?? '',
  });
}

/** One live session's held-open driver — built once per session, since the query and its
 *  cursors are exactly what must survive from one turn to the next. */
export interface HeldOpenDriver {
  /** Run `turn`, establishing a query or continuing the open one, and resolve when the turn
   *  boundaries. */
  run: (turn: QueuedTurn, session: LiveSession) => Promise<void>;
  /** Retire any open query (its input feed closes, the query terminates after its last
   *  result). Awaited by the dispatcher before it hands a turn to another strategy. */
  close: () => Promise<void>;
}

export function createHeldOpenDriver(
  ctx: TurnDriverDeps,
  persistentStore: ConversationStore | undefined,
): HeldOpenDriver {
  // `held` is the currently open query, if any; `seqBox`/`startedRef` are the query-lifetime
  // cursor + start handle its recorder and its per-turn user-append both write through.
  let held: HeldQuery | undefined;
  const seqBox: SeqBox = { value: 0 };
  const startedRef: StartedRef = { current: undefined };

  const close = async (): Promise<void> => {
    if (held === undefined) return;
    const closing = held;
    closing.close();
    await closing.done;
    if (held === closing) held = undefined;
  };

  return {
    close,
    run: async (turn, session) => {
      const configKey = configKeyOf(turn);
      // Re-establish (rather than continue) when the open query can no longer serve this
      // turn — otherwise a continue pushes into a feed with no consumer and hangs on a
      // boundary that never resolves. Two cases: (1) it has SETTLED — a prior interrupt
      // or mid-turn error already ended the query (its adapter loop is gone); the next
      // turn must start a fresh one, not resume the dead one (an interrupt must leave
      // the session usable). (2) its pinned prompt-shaping config + model DIFFER from this
      // turn's — a mid-conversation model/role/scope switch can't ride the pinned query.
      if (held !== undefined && (held.lifecycle.isSettled || held.configKey !== configKey))
        await close();

      if (held === undefined) {
        await establishHeldQuery(
          ctx,
          turn,
          session,
          configKey,
          persistentStore,
          seqBox,
          startedRef,
          (q) => {
            held = q;
          },
        );
      } else {
        await continueHeldQuery(ctx, turn, session, held, seqBox, startedRef);
      }
    },
  };
}

/**
 * Establish a held-open query for this turn: run the full persistence prelude, create the
 * derived {@link InputChannel} the query reads, start ONE session over it (NOT awaited to
 * completion — it spans every later turn), route steers + the close finalizer at it, feed
 * this turn, and await this turn's boundary. The per-turn-boundary transcript flush + cost
 * settle happen inside the adapter/loop at each result; the boundary is observed here from
 * the `turn-boundary` frame.
 */
async function establishHeldQuery(
  ctx: TurnDriverDeps,
  turn: QueuedTurn,
  session: LiveSession,
  configKey: string,
  persistentStore: ConversationStore | undefined,
  seqBox: SeqBox,
  startedRef: StartedRef,
  setHeld: (q: HeldQuery) => void,
): Promise<void> {
  startedRef.current = undefined;
  const prep = prepareTurnPersistence(turn, session, turn.role ?? '', persistentStore, seqBox);
  const channel = new InputChannel();
  const controller = new AbortController();
  const boundary = deferred();
  // ONE state for this query's current turn, shared by everything that used to consult a
  // flag: the recorder's inert check, the interrupt closure, the settlement, and the
  // session control the interrupt verb reaches it through.
  const lifecycle = new TurnLifecycle();

  // ONE recorder spans every turn this query ever runs — that is what the query-lifetime
  // cursor and start handle buy: a later turn's frames continue the same `seq` instead of
  // restarting it under the previous turn's.
  const recorder = createFrameRecorder({
    session,
    seqBox,
    startedRef,
    persistIn: prep.persistIn,
    // After a bare stop, everything the abandoned turn still emits is inert: its partial was
    // already settled, its marker recorded, and its driver released. Dropping the stragglers
    // keeps content from appearing BELOW the interrupt marker (never an error either).
    // The next turn re-arms the lifecycle (`continueHeldQuery`).
    isInert: () => lifecycle.inert,
    onSettled: (frame) => {
      if (frame.t === 'turn-boundary') noteTurnBoundary();
    },
  });

  const query: HeldQuery = {
    configKey,
    channel,
    persistIn: prep.persistIn,
    boundary,
    pendingTurns: 0,
    turnInterrupt: undefined,
    lifecycle,
    close: () => channel.close(),
    recorder,
    done: Promise.resolve(),
  };
  setHeld(query);

  /**
   * Feed whatever is still queued after a turn ends into the input feed as one plain next
   * turn, preserving FIFO order. Returns whether anything was fed.
   *
   * Recorded HERE, by the recorder's drain, like every other drain point: nothing wrote
   * these lines earlier. A `user` entry is then fed bare so the log and the model
   * agree on the text; a `system` entry is framed as a notice, so the model cannot read an
   * automated report as the person speaking.
   *
   * A sealed queue yields nothing, so a torn-down session is never revived by this.
   */
  function flushStrandedDeliveries(): boolean {
    if (session.deliveries.size() === 0) return false;
    const pending = recorder.takeDeliveries();
    if (pending.length === 0) return false;
    const text = pending
      .map((d) => (d.origin === 'system' ? FRAME_SYSTEM_NOTICE + d.text : d.text))
      .join('\n');
    query.pendingTurns += 1;
    channel.push(text);
    return true;
  }

  /**
   * One turn ended. Close out its deliveries, count it off, and — once nothing is still
   * outstanding — report `done` and release the driver parked on this turn. Deltas never
   * reach here: only a settled frame can end a turn.
   */
  function noteTurnBoundary(): void {
    // A turn can end with a tool still open (an interrupt, an error, a result that never
    // arrived). Nothing else will close it, so write what is parked rather than lose text
    // the model was already handed.
    recorder.flushDeliveries();
    query.pendingTurns -= 1;
    dbgSteer('boundary counted', { pendingTurns: query.pendingTurns });
    // Resolve the driver only when every outstanding turn has boundaried.
    if (query.pendingTurns > 0) return;
    query.pendingTurns = 0;
    // The turn is over, so any delivery still queued missed every mid-loop drain point this
    // turn had — the last of them has already fired and returned by the time this frame
    // lands. Feed it as an ordinary next turn instead of leaving it queued: the user has
    // already seen it rendered as their own turn, so silence is the one outcome that must
    // not happen. It becomes a real turn, so it takes the pending slot and this driver stays
    // parked until IT boundaries.
    if (flushStrandedDeliveries()) return;
    const started = startedRef.current;
    if (started !== undefined) ctx.emitStatus(session, started.worktree, 'done');
    query.boundary?.resolve();
    query.boundary = undefined;
  }

  // NOT awaited: this session call spans the whole live session. Its promise settles only
  // when the input feed closes (clean) or the query aborts (interrupt/error).
  query.done = createSession(
    {
      role: prep.role,
      ...(turn.roles !== undefined ? { roles: turn.roles } : {}),
      scope: turn.scope ?? '',
      input: channel,
      ...(turn.model ? { model: turn.model } : {}),
      ...(turn.packageIds !== undefined ? { packageIds: turn.packageIds } : {}),
      ...(turn.exclude !== undefined ? { exclude: turn.exclude } : {}),
      sessionId: session.id,
      // See the per-turn call site's identical spread: a root session's own spend
      // stays root-less; a spawned child's is tagged with its top-of-tree
      // ancestor, whatever the nesting depth.
      ...(session.parent !== undefined ? { root: session.root } : {}),
      ...buildPersistenceHooks(prep),
      signal: controller.signal,
      drainDeliveries: recorder.takeDeliveries,
      onTurnInterrupt: (fn) => {
        query.turnInterrupt = fn;
      },
      onStart: (s) => {
        startedRef.current = s;
        session.control = {
          controller,
          lifecycle,
          mode: 'held-open',
        };
        // A steer never abandons work in flight: while a turn runs it rides the session's
        // delivery queue, which the backend drains from inside that turn — beside the next
        // tool result, one round trip away, discarding nothing. Only an idle
        // steer enters the input feed, as a plain next turn, where send and pickup coincide.
        session.setSteerSink((text) => {
          if (query.pendingTurns > 0) {
            // NOT another backend turn, so it must not be counted — the in-flight turn still
            // owns the single pending slot. Its log line is written when the backend drains
            // it, not here.
            session.deliveries.push({ origin: 'user', text });
          } else {
            // Written here rather than left to the console's optimistic render: the console
            // shows the steer the instant it is sent, in the exact form the model saw, and a
            // later reload folds the same persisted frame into the same place — so the steer
            // never double-renders.
            recorder.writeFrame({ t: 'text', text, role: 'user' });
            channel.push(text);
          }
        });
        // A user stop (bare, no redirect). Settle whatever the model streamed so it PERSISTS
        // (deltas never do — docs/adr/0013 — so without this the partial renders live and
        // vanishes on reload) and record the interrupt marker, which also makes the model aware
        // next turn. Then stop the TURN via the backend's turn-level interrupt, keeping the
        // query alive for the next send: a whole-query abort does not reliably stop an
        // in-flight streaming response (the reported "stop does nothing"). A backend with no
        // turn-level interrupt falls back to the abort, which kills the query (re-established
        // on the next turn). Finally release the driver deterministically — an interrupted turn
        // emits no boundary, so nothing else ever would (a user stop, never an error).
        session.setInterruptClosure(() => {
          if (query.pendingTurns === 0) return false;
          // ORDER IS LOAD-BEARING: settle while the turn's frames still flow, THEN close
          // the stop. Closing first would make this query inert, and the interrupt marker
          // — itself a frame — would be dropped along with the stragglers it exists to
          // sit above.
          recorder.settleInterrupt();
          lifecycle.closeStop();
          dbgSteer('bare stop issued', {
            pendingTurns: query.pendingTurns,
            turnLevel: query.turnInterrupt !== undefined,
          });
          if (query.turnInterrupt !== undefined) {
            void (async () => {
              try {
                await query.turnInterrupt?.();
              } catch {
                // non-fatal: the turn is already closed for the user; the query settles or is
                // re-established on the next send.
              }
            })();
          } else {
            controller.abort();
          }
          query.pendingTurns = 0;
          const pending = query.boundary;
          query.boundary = undefined;
          pending?.resolve();
          return true;
        });
        session.setState('running', s.worktree);
        ctx.registry.touch(session.id);
        attachSubscriber(session, turn);
        turn.onReady?.(s);
      },
      onTurn: recorder.record,
    },
    ctx.deps,
  ).then(
    () => settleHeldQuery(ctx, session, query, startedRef, undefined),
    (err: unknown) => settleHeldQuery(ctx, session, query, startedRef, err),
  );

  // Closing the session ends this query's input feed ⇒ the query terminates after
  // the last turn's result (the held-open strategy's termination contract).
  session.onClose(() => query.close());

  query.pendingTurns += 1;
  channel.push(turn.input);
  await boundary.promise;
}

/**
 * Feed a further turn into an already-open held query (same config): append the
 * user turn (continuing the shared `seq`), re-mark `running` + (re)subscribe this
 * connection, push the text into the live feed, and await this turn's boundary.
 * No new session call — the open query's recorder handles the frames.
 */
async function continueHeldQuery(
  ctx: TurnDriverDeps,
  turn: QueuedTurn,
  session: LiveSession,
  query: HeldQuery,
  seqBox: SeqBox,
  startedRef: StartedRef,
): Promise<void> {
  // A bare stop closed the PREVIOUS turn but kept this query alive (turn-level interrupt).
  // Re-arm the one state: frames flow again, and the previous turn's stop must not make
  // this turn's settlement look like a user stop.
  query.lifecycle.beginTurn();
  if (query.persistIn !== undefined) {
    query.persistIn.store.append(query.persistIn.convId, [
      { seq: seqBox.value, frame: { t: 'text', text: turn.input, role: 'user' } },
    ]);
    seqBox.value += 1;
  }
  const started = startedRef.current;
  if (started !== undefined) {
    session.setState('running', started.worktree);
    ctx.registry.touch(session.id);
    // A caller sending its first turn to an already-live session subscribes here
    // (there is no fresh `onStart` on a continue turn).
    attachSubscriber(session, turn);
  }
  const boundary = deferred();
  query.boundary = boundary;
  query.pendingTurns += 1; // a normal continue expects one boundary
  query.channel.push(turn.input);
  await boundary.promise;
}

/**
 * Settle a held query once its long-lived session promise resolves (input feed closed) or
 * rejects (an interrupt-abort or a mid-turn provider drop). Clears the steer route +
 * control, releases any turn still awaiting a boundary, and — on a genuine (non-interrupt)
 * error — flushes a delivery still parked behind an open tool call (nothing else will ever
 * close it now — docs/adr/0031), drops the stale resume token, and surfaces the failure (an
 * interrupt is a user stop, never rendered as an error).
 */
function settleHeldQuery(
  ctx: TurnDriverDeps,
  session: LiveSession,
  query: HeldQuery,
  startedRef: StartedRef,
  err: unknown,
): void {
  // Read HOW the run ended before recording THAT it ended: `settled` is terminal and
  // carries no history, so the user-stop fact has to be taken while the phase still holds it.
  const stoppedByUser = query.lifecycle.stoppedByUser;
  query.lifecycle.settle();
  session.setSteerSink(undefined);
  session.control = undefined;
  // Release a turn parked on this query's boundary so its driver returns and the
  // live-session loop can advance/idle instead of hanging on a dead query.
  const pending = query.boundary;
  query.boundary = undefined;
  pending?.resolve();
  if (err === undefined) return; // clean termination: the per-turn `'done'` already fired.
  if (query.persistIn !== undefined)
    query.persistIn.store.clearBackendSession(query.persistIn.convId);
  if (stoppedByUser) return; // `interruptSession` already emitted `'interrupted'`.
  // A genuine mid-turn throw (most often a dropped provider connection) reaches neither the
  // interrupt closure nor a `turn-boundary` frame — the two other flush points — so nothing
  // else will ever write a line already parked behind a still-open tool call. Flush it BEFORE
  // the error frame below, so the log shows the delivery where the model actually read it,
  // above the failure that followed it (mirrors the interrupt closure's own ordering).
  query.recorder.flushDeliveries();
  const started = startedRef.current;
  if (started !== undefined) {
    const message = describeLoopFailure(err);
    // Written, not `record`ed: the recorder's per-frame path is gated by the query's own
    // inert flag, and a settlement error must land whatever the abandoned turn's state is.
    query.recorder.writeFrame({ t: 'error', message, origin: 'loop' });
    ctx.emitStatus(session, started.worktree, 'error', message);
  }
}
