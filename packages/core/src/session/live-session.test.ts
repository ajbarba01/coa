import { describe, it, expect } from 'vitest';
import type { Push, ToolCall } from '@coa/shared';
import { DEFAULT_PERMISSION_MODE, LiveSession } from './live-session.js';

const call: ToolCall = { tool: 'apply_patch', args: { target: 'src/a.ts' }, sessionId: 'c1' };

describe('LiveSession', () => {
  it('fans out an emitted push to every subscriber', () => {
    const s = new LiveSession('c1');
    const a: Push[] = [];
    const b: Push[] = [];
    s.subscribe((p) => a.push(p));
    s.subscribe((p) => b.push(p));
    const turn: Push = {
      kind: 'turn',
      sessionId: 'c1',
      worktree: '',
      seq: 0,
      frame: { t: 'text', text: 'hi' },
    };
    s.emit(turn);
    expect(a).toContainEqual(turn);
    expect(b).toContainEqual(turn);
  });

  it('emits the current run-status to a late subscriber (hydration)', () => {
    const s = new LiveSession('c1');
    s.setState('running', '/wt');
    const got: Push[] = [];
    s.subscribe((p) => got.push(p));
    expect(got).toContainEqual({
      kind: 'status',
      sessionId: 'c1',
      worktree: '/wt',
      state: 'running',
    });
  });

  it('nextTurn resolves with an enqueued turn, then undefined after close+drain', async () => {
    const s = new LiveSession('c1');
    s.enqueue({ input: 'first' });
    await expect(s.nextTurn()).resolves.toEqual({ input: 'first' });
    const pending = s.nextTurn();
    s.close();
    await expect(pending).resolves.toBeUndefined();
  });

  it('a turn still sitting in the queue at close time is dropped, not handed to a later nextTurn (Q14)', async () => {
    const s = new LiveSession('c1');
    // No `nextTurn()` has been called yet, so there is no parked waiter —
    // this lands in the internal queue rather than being resolved directly,
    // exactly like a turn sent while the driving loop is still busy with an
    // earlier one.
    s.enqueue({ input: 'queued-at-close' });
    s.close();
    // The queue must not outlive the session: a turn queued before close()
    // must never be drained afterward.
    await expect(s.nextTurn()).resolves.toBeUndefined();
  });

  it('enqueue after close is a no-op — the queue never accepts new work post-close (Q14)', () => {
    const s = new LiveSession('c1');
    s.close();
    s.enqueue({ input: 'too-late' });
    // Nothing should ever resolve from this: confirmed via a second call
    // racing a timeout would be flaky, so instead we assert the queue stayed
    // empty by immediately awaiting nextTurn and expecting undefined.
    return expect(s.nextTurn()).resolves.toBeUndefined();
  });

  it('holds an announcement until the FIRST subscriber attaches, then delivers it once', () => {
    const s = new LiveSession('c1');
    const advisory: Push = {
      kind: 'turn',
      sessionId: 'c1',
      worktree: '',
      seq: 0,
      frame: { t: 'error', origin: 'daemon', message: 'skill "ghost" did not resolve' },
    };
    // No subscriber yet — the exact founding-turn / child-spawn window.
    s.announce(advisory);
    const first: Push[] = [];
    s.subscribe((p) => first.push(p));
    // Hydration status first (the subscribe contract), then the held advisory.
    expect(first.map((p) => p.kind)).toEqual(['status', 'turn']);
    expect(first[1]).toEqual(advisory);
    // Delivered once: a later subscriber gets only its own hydration.
    const late: Push[] = [];
    s.subscribe((p) => late.push(p));
    expect(late.map((p) => p.kind)).toEqual(['status']);
  });

  it('announce delivers immediately when a subscriber is already attached', () => {
    const s = new LiveSession('c1');
    const got: Push[] = [];
    s.subscribe((p) => got.push(p));
    s.announce({
      kind: 'turn',
      sessionId: 'c1',
      worktree: '',
      seq: 0,
      frame: { t: 'error', origin: 'daemon', message: 'now' },
    });
    expect(got.filter((p) => p.kind === 'turn')).toHaveLength(1);
  });

  it('drops held announcements at close — nothing left to deliver to', () => {
    const s = new LiveSession('c1');
    s.announce({
      kind: 'turn',
      sessionId: 'c1',
      worktree: '',
      seq: 0,
      frame: { t: 'error', origin: 'daemon', message: 'never seen' },
    });
    s.close();
    const got: Push[] = [];
    s.subscribe((p) => got.push(p));
    expect(got.filter((p) => p.kind === 'turn')).toHaveLength(0);
  });

  it('unsubscribe stops delivery', () => {
    const s = new LiveSession('c1');
    const got: Push[] = [];
    const off = s.subscribe((p) => got.push(p));
    off();
    s.emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: '',
      seq: 1,
      frame: { t: 'text', text: 'x' },
    });
    expect(got.filter((p) => p.kind === 'turn')).toHaveLength(0);
  });

  it('a throwing sink does not stop fan-out to healthy sinks, and is dropped (FIX #2a)', () => {
    const s = new LiveSession('c1');
    const good: Push[] = [];
    s.subscribe(() => {
      throw new Error('dead sink');
    });
    s.subscribe((p) => good.push(p));
    const turn: Push = {
      kind: 'turn',
      sessionId: 'c1',
      worktree: '',
      seq: 0,
      frame: { t: 'text', text: 'hi' },
    };

    expect(() => s.emit(turn)).not.toThrow();
    expect(good).toContainEqual(turn);

    // The throwing sink was dropped — a second emit only grows the healthy sink's log.
    s.emit(turn);
    expect(good.filter((p) => p === turn || (p.kind === 'turn' && p.seq === 0))).toHaveLength(2);
  });
});

describe('LiveSession — steer routing', () => {
  it('routes a pushed steer to the installed sink', () => {
    const s = new LiveSession('c1');
    const seen: string[] = [];
    s.setSteerSink((text) => seen.push(text));
    expect(s.pushSteer('a')).toBe(true);
    expect(s.pushSteer('b')).toBe(true);
    expect(seen).toEqual(['a', 'b']);
  });

  it('pushSteer returns false when no sink is installed (per-turn fallback)', () => {
    const s = new LiveSession('c1');
    expect(s.pushSteer('a')).toBe(false);
  });
});

it('carries a delivery queue that close() seals', () => {
  const session = new LiveSession('conv-1');
  session.deliveries.push({ origin: 'user', text: 'steer' });
  session.deliveries.push({ origin: 'system', text: 'notice' });
  expect(session.deliveries.size()).toBe(2);
  session.close();
  expect(session.deliveries.isSealed()).toBe(true);
  expect(session.deliveries.drain()).toEqual([]);
});

it('seals the delivery queue before running finalizers, so a finalizer-enqueued delivery cannot survive', () => {
  const session = new LiveSession('conv-1');
  let sealedWhenFinalizerRan = false;
  session.onClose(() => {
    // Observed from inside the finalizer: proves seal() has already run by the time
    // this runs, not just that it eventually runs at some point during close().
    sealedWhenFinalizerRan = session.deliveries.isSealed();
    session.deliveries.push({ origin: 'system', text: 'late notice' });
  });
  session.close();
  expect(sealedWhenFinalizerRan).toBe(true);
  expect(session.deliveries.isSealed()).toBe(true);
  expect(session.deliveries.drain()).toEqual([]);
});

describe('LiveSession — F2 permission mode', () => {
  it('defaults to the system floor mode when the constructor is given none', () => {
    const s = new LiveSession('c1');
    expect(s.mode).toBe(DEFAULT_PERMISSION_MODE);
    expect(s.effectiveMode()).toBe(DEFAULT_PERMISSION_MODE);
  });

  it('accepts an explicit default mode (the agent-registry default a new session inherits)', () => {
    const s = new LiveSession('c1', undefined, 'plan');
    expect(s.mode).toBe('plan');
  });

  it('setMode switches the live mode and emits a reflection push', () => {
    const s = new LiveSession('c1');
    const got: Push[] = [];
    s.subscribe((p) => got.push(p));
    s.setMode('bypass');
    expect(got).toContainEqual({
      kind: 'mode',
      sessionId: 'c1',
      mode: 'bypass',
      effectiveMode: 'bypass',
    });
  });

  it('effectiveMode degrades to bypass when the backend has no approval seam, without touching the configured mode', () => {
    const s = new LiveSession('c1', undefined, 'manual');
    s.setApprovalSeam(false);
    expect(s.mode).toBe('manual');
    expect(s.effectiveMode()).toBe('bypass');
  });

  it('setApprovalSeam(false) emits a degraded mode reflection naming the honest effective mode', () => {
    const s = new LiveSession('c1', undefined, 'manual');
    const got: Push[] = [];
    s.subscribe((p) => got.push(p));
    s.setApprovalSeam(false);
    expect(got).toContainEqual({
      kind: 'mode',
      sessionId: 'c1',
      mode: 'manual',
      effectiveMode: 'bypass',
      degraded: expect.stringContaining('approval seam'),
    });
  });

  it('setApprovalSeam is a no-op push-wise when the effective mode does not change', () => {
    const s = new LiveSession('c1', undefined, 'bypass'); // already bypass either way
    const got: Push[] = [];
    s.subscribe((p) => got.push(p));
    s.setApprovalSeam(false);
    expect(got.filter((p) => p.kind === 'mode')).toHaveLength(0);
  });

  it('setApprovalSeam(true) after a degrade restores the configured mode as effective', () => {
    const s = new LiveSession('c1', undefined, 'edits');
    s.setApprovalSeam(false);
    expect(s.effectiveMode()).toBe('bypass');
    s.setApprovalSeam(true);
    expect(s.effectiveMode()).toBe('edits');
  });
});

describe('LiveSession — F2 ask/response round trip', () => {
  it('requestApproval blocks until resolveApproval answers, and an approve resolves allow', async () => {
    const s = new LiveSession('c1');
    let settled: 'allow' | 'deny' | undefined;
    const pending = s.requestApproval(call, 'write').then((d) => {
      settled = d;
      return d;
    });
    // Not settled yet — genuinely blocking, not a same-tick resolve.
    await Promise.resolve();
    expect(settled).toBeUndefined();

    const [request] = s.pendingApprovals();
    expect(request?.tool).toBe('apply_patch');
    const resolved = s.resolveApproval(request!.requestId, 'allow');
    expect(resolved).toBe(true);
    await expect(pending).resolves.toBe('allow');
  });

  it('a deny answer resolves deny', async () => {
    const s = new LiveSession('c1');
    const pending = s.requestApproval(call, 'exec');
    const [request] = s.pendingApprovals();
    s.resolveApproval(request!.requestId, 'deny');
    await expect(pending).resolves.toBe('deny');
  });

  it('resolving an unknown or already-answered request id is a harmless no-op', async () => {
    const s = new LiveSession('c1');
    expect(s.resolveApproval('nonexistent', 'allow')).toBe(false);

    const pending = s.requestApproval(call, 'write');
    const [request] = s.pendingApprovals();
    expect(s.resolveApproval(request!.requestId, 'allow')).toBe(true);
    // Answering the SAME id again is a no-op, not a second resolve.
    expect(s.resolveApproval(request!.requestId, 'deny')).toBe(false);
    await expect(pending).resolves.toBe('allow');
  });

  it('pushes an approval request live and a blocked-approval status, clearing back to running once answered', () => {
    const s = new LiveSession('c1');
    s.setState('running', '/wt');
    const got: Push[] = [];
    s.subscribe((p) => got.push(p));
    void s.requestApproval(call, 'write');

    expect(got).toContainEqual(
      expect.objectContaining({ kind: 'approval', tool: 'apply_patch', toolClass: 'write' }),
    );
    expect(got).toContainEqual({
      kind: 'status',
      sessionId: 'c1',
      worktree: '/wt',
      state: 'blocked-approval',
    });

    const [request] = s.pendingApprovals();
    s.resolveApproval(request!.requestId, 'allow');
    expect(got.at(-1)).toEqual({
      kind: 'status',
      sessionId: 'c1',
      worktree: '/wt',
      state: 'running',
    });
  });

  it('close() fail-safe-resolves every still-pending approval as deny rather than hanging forever', async () => {
    const s = new LiveSession('c1');
    const pending = s.requestApproval(call, 'write');
    s.close();
    await expect(pending).resolves.toBe('deny');
    expect(s.pendingApprovals()).toEqual([]);
  });

  it('abandonPendingApprovals fail-safe-denies every still-pending ask (a stopped turn will never make the call it was blocking)', async () => {
    const s = new LiveSession('c1');
    const first = s.requestApproval(call, 'write');
    const second = s.requestApproval({ ...call, tool: 'Bash' }, 'exec');
    expect(s.pendingApprovals()).toHaveLength(2);

    s.abandonPendingApprovals();

    await expect(first).resolves.toBe('deny');
    await expect(second).resolves.toBe('deny');
    expect(s.pendingApprovals()).toEqual([]);
  });

  it('abandonPendingApprovals emits no running/idle reflection of its own — unlike resolveApproval, it leaves the caller free to emit its own terminal status right after', () => {
    const s = new LiveSession('c1');
    s.setState('running', '/wt');
    const got: Push[] = [];
    // Subscribe first so its hydration push lands before the ask, then clear it — the
    // point under test is what `abandonPendingApprovals` ITSELF emits, not subscribe's.
    s.subscribe((p) => got.push(p));
    void s.requestApproval(call, 'write');
    got.length = 0;

    s.abandonPendingApprovals();

    expect(got).toEqual([]);
  });

  it('abandonPendingApprovals on a session with nothing pending is a harmless no-op', () => {
    const s = new LiveSession('c1');
    expect(() => s.abandonPendingApprovals()).not.toThrow();
    expect(s.pendingApprovals()).toEqual([]);
  });
});
