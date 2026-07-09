import { describe, it, expect, vi } from 'vitest';
import { LiveSessionRegistry } from './live-registry.js';

function fakeTimers() {
  const timers = new Map<number, () => void>();
  let id = 0;
  const setTimer = (fn: () => void) => { const t = ++id; timers.set(t, fn); return { clear: () => timers.delete(t) }; };
  const fireAll = () => { for (const fn of [...timers.values()]) fn(); };
  return { setTimer, fireAll, size: () => timers.size };
}

describe('LiveSessionRegistry', () => {
  it('getOrCreate returns the same session and flags creation only once', () => {
    const r = new LiveSessionRegistry();
    const a = r.getOrCreate('c1');
    const b = r.getOrCreate('c1');
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.session).toBe(b.session);
  });

  it('closes a session on idle-timeout and removes it', () => {
    const t = fakeTimers();
    const r = new LiveSessionRegistry({ idleMs: 1000, setTimer: t.setTimer });
    const { session } = r.getOrCreate('c1');
    const closed = vi.spyOn(session, 'close');
    t.fireAll();
    expect(closed).toHaveBeenCalled();
    expect(r.get('c1')).toBeUndefined();
  });

  it('touch re-arms the idle timer (old timer cleared)', () => {
    const t = fakeTimers();
    const r = new LiveSessionRegistry({ idleMs: 1000, setTimer: t.setTimer });
    r.getOrCreate('c1');
    r.touch('c1');
    expect(t.size()).toBe(1); // the prior timer was cleared, not stacked
  });

  it('closeAll tears down every session', () => {
    const r = new LiveSessionRegistry();
    r.getOrCreate('c1'); r.getOrCreate('c2');
    r.closeAll();
    expect(r.get('c1')).toBeUndefined();
    expect(r.get('c2')).toBeUndefined();
  });

  it('re-arms instead of evicting a session that is still running a turn (FIX #1)', () => {
    const t = fakeTimers();
    const r = new LiveSessionRegistry({ idleMs: 1000, setTimer: t.setTimer });
    const { session } = r.getOrCreate('c1');
    session.state = 'running';
    const closed = vi.spyOn(session, 'close');

    t.fireAll();

    expect(closed).not.toHaveBeenCalled();
    expect(r.get('c1')).toBeDefined();
    expect(t.size()).toBe(1); // re-armed, not left un-timed or stacked

    // Once genuinely idle, the (re-armed) timer firing evicts it.
    session.state = 'idle';
    t.fireAll();

    expect(closed).toHaveBeenCalled();
    expect(r.get('c1')).toBeUndefined();
  });

  it('close(id) invokes onClose with the session before removing it', () => {
    const closed: string[] = [];
    const r = new LiveSessionRegistry({ onClose: (s) => closed.push(s.id) });
    r.getOrCreate('c1');

    r.close('c1');

    expect(closed).toEqual(['c1']);
  });

  it('idle-eviction invokes onClose too', () => {
    const t = fakeTimers();
    const closed: string[] = [];
    const r = new LiveSessionRegistry({ idleMs: 1000, setTimer: t.setTimer, onClose: (s) => closed.push(s.id) });
    r.getOrCreate('c1');

    t.fireAll();

    expect(closed).toEqual(['c1']);
  });

  it('closeAll invokes onClose for every session', () => {
    const closed: string[] = [];
    const r = new LiveSessionRegistry({ onClose: (s) => closed.push(s.id) });
    r.getOrCreate('c1');
    r.getOrCreate('c2');

    r.closeAll();

    expect(closed.sort()).toEqual(['c1', 'c2']);
  });

  it('close(id) aborts an in-flight turn and marks it interrupted first (SC-1-safe abort)', () => {
    const r = new LiveSessionRegistry();
    const { session } = r.getOrCreate('c1');
    const controller = new AbortController();
    session.control = { controller, steer: [], queueSteer: [], interrupted: false };

    r.close('c1');

    expect(controller.signal.aborted).toBe(true);
    expect(session.control?.interrupted).toBe(true);
  });
});
