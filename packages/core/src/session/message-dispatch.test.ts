import { describe, expect, it } from 'vitest';
import {
  buildRoster,
  dispatchMessage,
  type DispatchDeps,
  type LiveState,
  type MeshLookup,
  type RosterMember,
} from './message-dispatch.js';
import type { AgentMessage } from './message-log.js';
import type { SessionEndReason } from './notify.js';

/** A tiny in-memory fixture: a tree of sessions keyed by id, each session's live
 *  state, and a message log stub for thread resolution — enough to exercise
 *  `dispatchMessage` without any real registry/store/log. */
function fixture(opts: {
  sessions: Record<string, MeshLookup>;
  live?: Record<string, LiveState>;
  log?: AgentMessage[];
  ids?: string[];
}): { deps: DispatchDeps } {
  const live = opts.live ?? {};
  const log = opts.log ?? [];
  const ids = [...(opts.ids ?? [])];
  let now = 0;
  return {
    deps: {
      lookup: (id) => opts.sessions[id],
      liveState: (id) => live[id] ?? 'idle',
      resolveThread: (replyTo) => log.find((m) => m.id === replyTo)?.threadId,
      newId: () => ids.shift() ?? `id-${now}`,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, now++)).toISOString(),
    },
  };
}

describe('dispatchMessage — mesh membership', () => {
  it('dispatches between two members of the same tree', () => {
    const { deps } = fixture({
      sessions: {
        a: { root: 'root', agentRef: 'swe' },
        b: { root: 'root', agentRef: 'reviewer' },
      },
      ids: ['msg-1'],
    });
    const out = dispatchMessage({ from: 'a', to: 'b', body: 'hi' }, deps);
    expect(out.applied).toBe(true);
    if (!out.applied) throw new Error('unreachable');
    expect(out.message).toMatchObject({
      id: 'msg-1',
      threadId: 'msg-1',
      from: 'a',
      to: 'b',
      root: 'root',
    });
    expect(out.fromAgentRef).toBe('swe');
  });

  it('lets the root itself message a descendant (the root has no stored `root` field — it IS the root)', () => {
    const { deps } = fixture({
      sessions: {
        root: { agentRef: 'swe' }, // no `root` field — defaults to itself
        child: { root: 'root', agentRef: 'explorer' },
      },
      ids: ['msg-1'],
    });
    const out = dispatchMessage({ from: 'root', to: 'child', body: 'go' }, deps);
    expect(out.applied).toBe(true);
  });

  it('refuses a message to a session outside the sender’s family tree', () => {
    const { deps } = fixture({
      sessions: {
        a: { root: 'root-1', agentRef: 'swe' },
        x: { root: 'root-2', agentRef: 'other' },
      },
    });
    const out = dispatchMessage({ from: 'a', to: 'x', body: 'hi' }, deps);
    expect(out.applied).toBe(false);
    if (out.applied) throw new Error('unreachable');
    expect(out.error.code).toBe('out-of-tree');
  });

  it('refuses a message to a session outside the tree even when the SENDER is the root itself', () => {
    const { deps } = fixture({
      sessions: {
        root: { agentRef: 'swe' },
        x: { root: 'root-2', agentRef: 'other' },
      },
    });
    const out = dispatchMessage({ from: 'root', to: 'x', body: 'hi' }, deps);
    expect(out.applied).toBe(false);
  });

  it('allows a session to message itself (harmless, not specially forbidden)', () => {
    const { deps } = fixture({
      sessions: { a: { root: 'root', agentRef: 'swe' } },
      ids: ['msg-1'],
    });
    const out = dispatchMessage({ from: 'a', to: 'a', body: 'note to self' }, deps);
    expect(out.applied).toBe(true);
  });
});

describe('dispatchMessage — orphan / closed-target semantics', () => {
  it('refuses a message to a session that was never known at all', () => {
    const { deps } = fixture({ sessions: { a: { root: 'root', agentRef: 'swe' } } });
    const out = dispatchMessage({ from: 'a', to: 'ghost', body: 'hi' }, deps);
    expect(out.applied).toBe(false);
    if (out.applied) throw new Error('unreachable');
    expect(out.error.code).toBe('unknown-target');
  });

  it('still dispatches to a KNOWN session that already ended (idle-evicted, not currently registered) — plan is wake', () => {
    const { deps } = fixture({
      sessions: {
        a: { root: 'root', agentRef: 'swe' },
        b: { root: 'root', agentRef: 'explorer' },
      },
      live: { b: 'not-registered' },
      ids: ['msg-1'],
    });
    const out = dispatchMessage({ from: 'a', to: 'b', body: 'still there?' }, deps);
    expect(out.applied).toBe(true);
    if (!out.applied) throw new Error('unreachable');
    expect(out.plan).toEqual({ kind: 'wake' });
  });

  it('still dispatches even when the WHOLE ROOT has been torn down, as long as sender and target still agree on it', () => {
    // The root itself is gone from the live registry (`liveState('root') === 'not-registered'`),
    // but `root`/`child` still share the same stored root value — messaging a surviving
    // member of an orphaned tree is not refused (docs/adr/0039's deliberate deviation:
    // there is no "permanently dead" session in coa's model).
    const { deps } = fixture({
      sessions: {
        a: { root: 'root', agentRef: 'swe' },
        b: { root: 'root', agentRef: 'explorer' },
      },
      live: { root: 'not-registered', a: 'not-registered', b: 'not-registered' },
      ids: ['msg-1'],
    });
    const out = dispatchMessage({ from: 'a', to: 'b', body: 'hello?' }, deps);
    expect(out.applied).toBe(true);
  });
});

describe('dispatchMessage — delivery plan by receiver state', () => {
  it('plans mid-turn delivery when the receiver is actively running', () => {
    const { deps } = fixture({
      sessions: { a: { root: 'root', agentRef: 'swe' }, b: { root: 'root', agentRef: 'x' } },
      live: { b: 'running' },
      ids: ['msg-1'],
    });
    const out = dispatchMessage({ from: 'a', to: 'b', body: 'hi' }, deps);
    if (!out.applied) throw new Error('unreachable');
    expect(out.plan).toEqual({ kind: 'mid-turn' });
  });

  it('plans a wake for an idle (registered, between turns) receiver', () => {
    const { deps } = fixture({
      sessions: { a: { root: 'root', agentRef: 'swe' }, b: { root: 'root', agentRef: 'x' } },
      live: { b: 'idle' },
      ids: ['msg-1'],
    });
    const out = dispatchMessage({ from: 'a', to: 'b', body: 'hi' }, deps);
    if (!out.applied) throw new Error('unreachable');
    expect(out.plan).toEqual({ kind: 'wake' });
  });

  it('plans a wake for a not-yet-started receiver (registered but its founding turn has not run)', () => {
    // Mechanically identical to idle from this module's point of view — see the
    // `DeliveryPlan` doc for why coa's turn model collapses idle/finished/not-yet-started.
    const { deps } = fixture({
      sessions: { a: { root: 'root', agentRef: 'swe' }, b: { root: 'root', agentRef: 'x' } },
      live: { b: 'idle' },
      ids: ['msg-1'],
    });
    const out = dispatchMessage({ from: 'a', to: 'b', body: 'hi' }, deps);
    if (!out.applied) throw new Error('unreachable');
    expect(out.plan).toEqual({ kind: 'wake' });
  });
});

describe('dispatchMessage — thread identity', () => {
  it('anchors a fresh message to its own id as the thread', () => {
    const { deps } = fixture({
      sessions: { a: { root: 'root', agentRef: 'swe' }, b: { root: 'root', agentRef: 'x' } },
      ids: ['msg-1'],
    });
    const out = dispatchMessage({ from: 'a', to: 'b', body: 'hi' }, deps);
    if (!out.applied) throw new Error('unreachable');
    expect(out.message.threadId).toBe(out.message.id);
    expect(out.message.replyTo).toBeUndefined();
  });

  it('a reply carries the ORIGINAL thread id, not its own id', () => {
    const original: AgentMessage = {
      id: 'msg-1',
      threadId: 'msg-1',
      from: 'a',
      to: 'b',
      root: 'root',
      body: 'question',
      createdAt: 'x',
    };
    const { deps } = fixture({
      sessions: { a: { root: 'root', agentRef: 'swe' }, b: { root: 'root', agentRef: 'x' } },
      log: [original],
      ids: ['msg-2'],
    });
    const out = dispatchMessage({ from: 'b', to: 'a', body: 'answer', replyTo: 'msg-1' }, deps);
    if (!out.applied) throw new Error('unreachable');
    expect(out.message).toMatchObject({ id: 'msg-2', threadId: 'msg-1', replyTo: 'msg-1' });
  });

  it('a chained reply (reply to a reply) still resolves to the ROOT thread id', () => {
    const original: AgentMessage = {
      id: 'msg-1',
      threadId: 'msg-1',
      from: 'a',
      to: 'b',
      root: 'root',
      body: 'q',
      createdAt: 'x',
    };
    const firstReply: AgentMessage = {
      id: 'msg-2',
      threadId: 'msg-1',
      replyTo: 'msg-1',
      from: 'b',
      to: 'a',
      root: 'root',
      body: 'a',
      createdAt: 'x',
    };
    const { deps } = fixture({
      sessions: { a: { root: 'root', agentRef: 'swe' }, b: { root: 'root', agentRef: 'x' } },
      log: [original, firstReply],
      ids: ['msg-3'],
    });
    const out = dispatchMessage({ from: 'a', to: 'b', body: 'follow-up', replyTo: 'msg-2' }, deps);
    if (!out.applied) throw new Error('unreachable');
    expect(out.message.threadId).toBe('msg-1');
  });

  it('falls back to the replyTo id itself as the thread anchor when it does not resolve (never throws)', () => {
    const { deps } = fixture({
      sessions: { a: { root: 'root', agentRef: 'swe' }, b: { root: 'root', agentRef: 'x' } },
      ids: ['msg-1'],
    });
    const out = dispatchMessage({ from: 'a', to: 'b', body: 'hi', replyTo: 'unknown-msg' }, deps);
    if (!out.applied) throw new Error('unreachable');
    expect(out.message.threadId).toBe('unknown-msg');
  });
});

describe('dispatchMessage — dispatch ordering', () => {
  it('two messages sent back to back preserve send order via distinct, sequential ids', () => {
    const { deps } = fixture({
      sessions: { a: { root: 'root', agentRef: 'swe' }, b: { root: 'root', agentRef: 'x' } },
      ids: ['msg-1', 'msg-2'],
    });
    const first = dispatchMessage({ from: 'a', to: 'b', body: 'one' }, deps);
    const second = dispatchMessage({ from: 'a', to: 'b', body: 'two' }, deps);
    if (!first.applied || !second.applied) throw new Error('unreachable');
    expect([first.message.id, second.message.id]).toEqual(['msg-1', 'msg-2']);
    expect(first.message.createdAt < second.message.createdAt).toBe(true);
  });
});

// ---- buildRoster ----

function member(id: string, agentRef: string, parent?: string): RosterMember {
  return parent === undefined ? { id, agentRef } : { id, agentRef, parent };
}

describe('buildRoster — relationship-relative shape', () => {
  const tree: RosterMember[] = [
    member('root', 'swe'),
    member('mid', 'explorer', 'root'),
    member('leaf', 'reviewer', 'mid'),
    member('sibling', 'other', 'root'),
    member('cousin', 'x', 'sibling'),
  ];
  const alwaysIdle = (): LiveState => 'idle';
  const neverEnded = (): undefined => undefined;

  it('labels self, parent, child, ancestor, descendant, and other correctly from the middle of the tree', () => {
    const roster = buildRoster('mid', tree, alwaysIdle, neverEnded);
    const byId = new Map(roster.map((r) => [r.sessionId, r]));
    expect(byId.get('mid')?.relation).toBe('self');
    expect(byId.get('root')?.relation).toBe('parent');
    expect(byId.get('leaf')?.relation).toBe('child');
    expect(byId.get('sibling')?.relation).toBe('other');
    expect(byId.get('cousin')?.relation).toBe('other');
  });

  it('labels a deep ancestor/descendant correctly from the root', () => {
    const roster = buildRoster('root', tree, alwaysIdle, neverEnded);
    const byId = new Map(roster.map((r) => [r.sessionId, r]));
    expect(byId.get('root')?.relation).toBe('self');
    expect(byId.get('mid')?.relation).toBe('child');
    expect(byId.get('leaf')?.relation).toBe('descendant');
    expect(byId.get('sibling')?.relation).toBe('child');
  });

  it('labels an ancestor two hops up as `ancestor`, not `parent`', () => {
    const roster = buildRoster('leaf', tree, alwaysIdle, neverEnded);
    const byId = new Map(roster.map((r) => [r.sessionId, r]));
    expect(byId.get('mid')?.relation).toBe('parent');
    expect(byId.get('root')?.relation).toBe('ancestor');
  });

  it('grades confidence: registered (running or idle) is always observed', () => {
    const live = (id: string): LiveState => (id === 'mid' ? 'running' : 'idle');
    const roster = buildRoster('root', tree, live, neverEnded);
    const byId = new Map(roster.map((r) => [r.sessionId, r]));
    expect(byId.get('mid')?.confidence).toBe('observed');
    expect(byId.get('leaf')?.confidence).toBe('observed'); // idle, still registered
  });

  it('grades confidence: not-registered with an observed end reason is still observed, high-confidence', () => {
    const live = (): LiveState => 'not-registered';
    const lastEnd = (id: string): { reason: SessionEndReason; at: string } | undefined =>
      id === 'leaf' ? { reason: 'completed', at: 't' } : undefined;
    const roster = buildRoster('root', tree, live, lastEnd);
    const byId = new Map(roster.map((r) => [r.sessionId, r]));
    expect(byId.get('leaf')?.confidence).toBe('observed');
    expect(byId.get('leaf')?.endReason).toBe('completed');
  });

  it('grades confidence: not-registered with no observed end reason is advisory (silence-derived, per the design doc)', () => {
    const live = (): LiveState => 'not-registered';
    const roster = buildRoster('root', tree, live, neverEnded);
    const byId = new Map(roster.map((r) => [r.sessionId, r]));
    expect(byId.get('mid')?.confidence).toBe('advisory');
    expect(byId.get('mid')?.endReason).toBeUndefined();
  });

  it('is cycle-safe: a hand-edited or adversarial parent cycle does not loop forever', () => {
    const cyclic: RosterMember[] = [
      member('a', 'x', 'b'),
      member('b', 'x', 'a'),
      member('c', 'x', 'a'),
    ];
    expect(() => buildRoster('a', cyclic, alwaysIdle, neverEnded)).not.toThrow();
    const roster = buildRoster('a', cyclic, alwaysIdle, neverEnded);
    expect(roster).toHaveLength(3);
  });
});
