/**
 * A turn's lifecycle, as ONE named state with explicit transitions.
 *
 * It replaces two booleans that three modules used to keep in agreement by hand: the
 * session control's `interrupted` (set by the interrupt verb, cleared again on a
 * no-op stop, cleared a third time when a held-open query took its next turn, read at
 * every settlement) and the held-open query's `stopped` (set inside the interrupt
 * closure, read per frame by the recorder). Neither flag was ever wrong on its own. The
 * hazard was the combinations nobody had named — a stop asked for but never closed, a
 * stop still marked on a query that had already moved on — because an unnamed state is a
 * state no test covers, and that is the shape this layer's last real bug came in.
 *
 * Every legal edge is enumerated in {@link TRANSITIONS}. An event with no edge from the
 * current phase leaves the phase untouched and reports `false`, so an illegal transition
 * is not something a caller can express — it would have to be granted by the table. A
 * user stop is a USER ACTION, never a governance block, so nothing here throws, denies,
 * or blocks: the machine reports what it did and the caller decides what that means.
 *
 * This is the TURN's lifecycle, not the session's run status. `RunState`
 * (`idle`/`running`, in live-session.ts) is a published fact — it is fanned out to every
 * subscriber as the `status` push — and stays where it is.
 */

/** Where the currently-driven turn stands. */
export type TurnPhase =
  /** A turn is in flight; its frames are live. */
  | 'running'
  /** A user stop has been asked for and the turn is not closed yet. The partial has not
   *  been settled, so frames must still flow — the interrupt marker is itself a frame. */
  | 'stop-requested'
  /** A user stop closed the turn: its streamed partial is settled, its marker recorded,
   *  and everything the abandoned turn still emits is inert. A held-open query survives
   *  this — its next turn re-arms to `running`. */
  | 'stopped'
  /** The run carrying the turn has ended, however it ended. Terminal: a settled run is
   *  never resumed, it is replaced. */
  | 'settled';

/** What can happen to a turn. Named for the ACTION, not the resulting phase, because the
 *  same action means different things from different phases. */
type TurnEvent = 'request-stop' | 'close-stop' | 'abandon-stop' | 'begin-turn' | 'settle';

/**
 * The whole state machine, as data. A phase missing from an event's row has no edge for
 * that event — that is how the illegal moves stay unexpressible: un-stopping a stopped
 * turn, closing a stop nobody asked for, or reviving a settled run would each need a new
 * entry here, in the open, rather than a flag flipped in some other file.
 */
const TRANSITIONS: Readonly<Record<TurnEvent, Readonly<Partial<Record<TurnPhase, TurnPhase>>>>> = {
  // Only a running turn can be stopped. A second Stop against an already-stopped turn
  // finds no edge and is reported as "nothing to stop".
  'request-stop': { running: 'stop-requested' },
  // The driver closed the turn it was asked to stop. Reachable only from the request, so
  // the settle-then-close ordering the marker depends on cannot be skipped.
  'close-stop': { 'stop-requested': 'stopped' },
  // The driver found no turn in flight after all (a held-open query keeps its control
  // between turns), so the request is withdrawn rather than left half-applied.
  'abandon-stop': { 'stop-requested': 'running' },
  // A held-open query feeding its next turn: from a stop, this is the re-arm that makes
  // frames flow again; from a plain continue it changes nothing.
  'begin-turn': { running: 'running', stopped: 'running' },
  settle: { running: 'settled', 'stop-requested': 'settled', stopped: 'settled' },
};

/**
 * The one owner of a turn's phase. Built per RUN — per turn for the per-turn strategy,
 * per query for the held-open one, since that is the span the phase describes. The
 * drivers and the session service read it and request transitions; nothing else writes.
 */
export class TurnLifecycle {
  #phase: TurnPhase = 'running';

  get phase(): TurnPhase {
    return this.#phase;
  }

  /** Whether everything the turn still emits must be dropped. True once a stop has actually
   *  closed the turn (its partial is already settled and its marker recorded, so a straggler
   *  would render BELOW the interrupt marker), and true again once the run has settled by any
   *  path — settlement is terminal, and every write a settlement itself still needs to make
   *  (the genuine-failure frame in settleHeldQuery) goes through `writeFrame` directly rather
   *  than this gate, so nothing legitimate is ever lost by closing the gate here too. Without
   *  the second half, a straggler arriving after settle() moved the phase off `stopped` would
   *  read this as false and be recorded — the exact hazard this getter exists to prevent, just
   *  moved one step later. */
  get inert(): boolean {
    return this.#phase === 'stopped' || this.#phase === 'settled';
  }

  /** Whether the end this run is reaching is a USER STOP rather than a failure — the one
   *  question every settlement asks, so that a stop is never rendered as an error. True
   *  from the moment the stop is requested, since a stop the driver has not closed yet
   *  (a cascade close aborts without going through the closure) still ends the turn. */
  get stoppedByUser(): boolean {
    return this.#phase === 'stop-requested' || this.#phase === 'stopped';
  }

  /** Whether the run has ended. A held-open driver re-establishes rather than continuing
   *  into one of these — a settled query's input feed has no consumer left. */
  get isSettled(): boolean {
    return this.#phase === 'settled';
  }

  /** Ask to stop the in-flight turn. `false` ⇒ there is no running turn to stop. */
  requestStop(): boolean {
    return this.#apply('request-stop');
  }

  /** Report that the requested stop has closed the turn. Call this AFTER settling the
   *  partial and recording the marker: it is what makes the remaining frames inert. */
  closeStop(): boolean {
    return this.#apply('close-stop');
  }

  /** Withdraw a requested stop that found no turn in flight. */
  abandonStop(): boolean {
    return this.#apply('abandon-stop');
  }

  /** A further turn is being fed into this run (the held-open continue). */
  beginTurn(): boolean {
    return this.#apply('begin-turn');
  }

  /** The run has ended. Read {@link stoppedByUser} first — this phase is terminal and
   *  does not carry how the run got here. */
  settle(): boolean {
    return this.#apply('settle');
  }

  #apply(event: TurnEvent): boolean {
    const next = TRANSITIONS[event][this.#phase];
    if (next === undefined) return false;
    this.#phase = next;
    return true;
  }
}
