import { describe, it, expect } from 'vitest';
import { TurnLifecycle } from './turn-lifecycle.js';

/**
 * These cover the states the two booleans used to leave unnamed. The interesting cases are
 * not the happy path — they are the combinations three modules could previously produce by
 * hand: a stop requested and then withdrawn, a stop already closed when a second one
 * arrives, and a run that has settled.
 */
describe('TurnLifecycle', () => {
  it('starts running, with nothing inert and no stop in sight', () => {
    const t = new TurnLifecycle();
    expect(t.phase).toBe('running');
    expect(t.inert).toBe(false);
    expect(t.stoppedByUser).toBe(false);
    expect(t.isSettled).toBe(false);
  });

  it('keeps frames flowing while a stop is only REQUESTED — the interrupt marker is one of them', () => {
    const t = new TurnLifecycle();
    expect(t.requestStop()).toBe(true);
    expect(t.phase).toBe('stop-requested');
    // Nothing is dropped yet: the driver still has to settle the partial and record the
    // marker, and both go through the same frame path the stragglers do.
    expect(t.inert).toBe(false);
    // …but a settlement landing right now is already a user stop, never an error. This is
    // the cascade-close path, which aborts without ever running the driver's closure.
    expect(t.stoppedByUser).toBe(true);
  });

  it('goes inert only once the stop is CLOSED', () => {
    const t = new TurnLifecycle();
    t.requestStop();
    expect(t.closeStop()).toBe(true);
    expect(t.phase).toBe('stopped');
    expect(t.inert).toBe(true);
    expect(t.stoppedByUser).toBe(true);
  });

  it('cannot close a stop nobody asked for', () => {
    const t = new TurnLifecycle();
    expect(t.closeStop()).toBe(false);
    expect(t.phase).toBe('running');
    expect(t.inert).toBe(false);
  });

  it('withdraws a requested stop the driver found no turn for', () => {
    const t = new TurnLifecycle();
    t.requestStop();
    expect(t.abandonStop()).toBe(true);
    expect(t.phase).toBe('running');
    expect(t.stoppedByUser).toBe(false);
  });

  it('reports a redundant stop as nothing-to-stop, leaving the first stop marked', () => {
    const t = new TurnLifecycle();
    t.requestStop();
    t.closeStop();

    expect(t.requestStop()).toBe(false);
    // The withdrawal that follows a negative result must not un-stop the closed turn:
    // a query aborting later still ended on a user stop, so it is never an error.
    expect(t.abandonStop()).toBe(false);
    expect(t.phase).toBe('stopped');
    expect(t.stoppedByUser).toBe(true);
  });

  it('re-arms on the next turn, because a held-open query outlives a turn-level stop', () => {
    const t = new TurnLifecycle();
    t.requestStop();
    t.closeStop();

    expect(t.beginTurn()).toBe(true);
    expect(t.phase).toBe('running');
    expect(t.inert).toBe(false);
    expect(t.stoppedByUser).toBe(false);
  });

  it('leaves a plain continue running', () => {
    const t = new TurnLifecycle();
    expect(t.beginTurn()).toBe(true);
    expect(t.phase).toBe('running');
  });

  it('settles from every live phase and never comes back', () => {
    for (const arrive of [
      (t: TurnLifecycle) => t,
      (t: TurnLifecycle) => {
        t.requestStop();
        return t;
      },
      (t: TurnLifecycle) => {
        t.requestStop();
        t.closeStop();
        return t;
      },
    ]) {
      const t = arrive(new TurnLifecycle());
      expect(t.settle()).toBe(true);
      expect(t.isSettled).toBe(true);
      // A settled run is as inert as a stopped one, whichever phase it settled FROM: nothing
      // legitimate is ever recorded through this gate once settlement has run (a settlement's
      // own writes bypass it), so anything still arriving is a straggler by definition.
      expect(t.inert).toBe(true);
      // Terminal: a settled run is replaced, never resumed — so nothing revives it.
      expect(t.settle()).toBe(false);
      expect(t.beginTurn()).toBe(false);
      expect(t.requestStop()).toBe(false);
      expect(t.closeStop()).toBe(false);
      expect(t.phase).toBe('settled');
    }
  });
});
