// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentFile, AgentSummary, TurnFrame } from '@coa/console-viewmodel';
import { MOCK_AGENTS } from '../testing/mockAgents.js';
import { useNotices } from '../shell/failures.js';
import { useShell } from '../shell/store.js';
import { consoleActions, resetActions } from './actions.js';
import type { ConsoleBridge } from './bridge.js';
import { startConsole, TRANSCRIPT_CAP, type ConsoleController } from './controller.js';
import { detectAuthFailure, modelSwitchNoteText, onAuthFailure } from './notices.js';
import { resetDaemonData, useDaemonData } from './data.js';
import { resetProjectState } from './reset.js';
import { resetSessions, useSessions } from './sessions.js';
import { appendFrames, flushFrames, resetTranscripts, useTranscripts } from './transcripts.js';
import { resetConsoleUi, useConsoleUi } from './ui.js';

/** A daemon-backed session + its persisted transcript, fed through the fake bridge. */
const FAKE_SESSIONS = [
  {
    id: 'c1',
    agentRef: 'roles/reviewer',
    title: 'refactor auth module',
    updatedAt: '2026-07-02T00:00:00Z',
  },
];
const FAKE_TURNS = [
  { seq: 0, frame: { t: 'text', text: 'Refactor the auth module', role: 'user' } },
  { seq: 1, frame: { t: 'text', text: 'on it' } },
];
/** `reloadConversation` answers with the turns it could read AND how many stored events
 *  it could not — a record that read cleanly is `skipped: 0`. */
const reloaded = (turns: unknown[] = FAKE_TURNS, skipped = 0) => ({ turns, skipped });

function fakeBridge(over: Partial<ConsoleBridge> = {}): ConsoleBridge {
  return {
    capState: vi.fn().mockResolvedValue({ remaining: 2.5, capHit: false }),
    flagsForUser: vi.fn().mockResolvedValue({ expanded: [], collapsed: [] }),
    listTimeline: vi.fn().mockResolvedValue([]),
    listAccounts: vi.fn().mockResolvedValue({ accounts: [], active: {} }),
    currentAccount: vi.fn().mockResolvedValue({ active: {} }),
    useAccount: vi.fn().mockResolvedValue({ active: {} }),
    startSession: vi.fn().mockResolvedValue({ sessionId: 'c1', worktree: '/wt' }),
    listModels: vi.fn().mockResolvedValue([]),
    modelMetadata: vi.fn().mockResolvedValue({ entries: [] }),
    listRoles: vi.fn().mockResolvedValue([]),
    listPackages: vi.fn().mockResolvedValue([]),
    listAgents: vi.fn().mockResolvedValue({ agents: MOCK_AGENTS, diagnostics: [] }),
    saveAgent: vi.fn().mockResolvedValue({ ok: true }),
    deleteAgent: vi.fn().mockResolvedValue({ removed: true }),
    listSessions: vi.fn().mockResolvedValue(FAKE_SESSIONS),
    listWorktrees: vi.fn().mockResolvedValue({ worktrees: [] }),
    reapWorktree: vi.fn().mockResolvedValue({ reaped: true }),
    newSession: vi.fn().mockResolvedValue({ id: 'c-new' }),
    reloadConversation: vi.fn().mockResolvedValue(reloaded()),
    deleteSession: vi.fn().mockResolvedValue({ ok: true }),
    recompilePrompt: vi.fn().mockResolvedValue({ recompiled: true }),
    interruptSession: vi.fn().mockResolvedValue({ interrupted: true }),
    steerSession: vi.fn().mockResolvedValue({ steered: true }),
    subscribeSession: vi.fn().mockResolvedValue({ subscribed: true }),
    setMode: vi.fn().mockResolvedValue({ set: true }),
    respondApproval: vi.fn().mockResolvedValue({ resolved: true }),
    sessionMode: vi.fn().mockResolvedValue({ found: false }),
    openPath: vi.fn().mockResolvedValue({ ok: true, revealed: 'editor' }),
    openExternal: vi.fn().mockResolvedValue({ ok: true }),
    onPush: vi.fn().mockReturnValue(() => {}),
    getSettings: vi.fn().mockResolvedValue({ theme: 'dark', motion: 'full', pinnedAgents: [] }),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

/** One agent file on the fake disk. Keyed the way disk actually is — one file per
 *  (scope, ref) — so a scope move that half-completes is observable as a surviving
 *  file, not merely as a mock call order. */
interface DiskAgentFile {
  scope: 'personal' | 'project';
  ref: string;
  file: AgentFile;
}

/** A stand-in for the daemon's per-agent-file registry. `listAgents` folds the scopes
 *  the way the daemon's own merge does (personal then project, project winning a
 *  shared ref), so a leftover copy in the losing scope is invisible in the list —
 *  exactly as it would be in the real app. */
function fakeAgentDisk(seed: AgentSummary[]) {
  let files: DiskAgentFile[] = seed.flatMap((a): DiskAgentFile[] => {
    const { ref, scope, ...file } = a;
    return scope === 'builtin' ? [] : [{ ref, scope, file }];
  });
  return {
    /** Every scope that currently holds a file for this ref — empty means the file is gone. */
    scopesOf: (ref: string): ('personal' | 'project')[] =>
      files.filter((f) => f.ref === ref).map((f) => f.scope),
    saveAgent: (p: { ref: string; scope: 'personal' | 'project'; file: AgentFile }) => {
      files = [...files.filter((f) => !(f.ref === p.ref && f.scope === p.scope)), { ...p }];
      return Promise.resolve({ ok: true });
    },
    deleteAgent: (p: { ref: string; scope: 'personal' | 'project' }) => {
      const before = files.length;
      files = files.filter((f) => !(f.ref === p.ref && f.scope === p.scope));
      return Promise.resolve({ removed: files.length < before });
    },
    listAgents: () => {
      const byRef = new Map<string, AgentSummary>();
      for (const scope of ['personal', 'project'] as const) {
        for (const f of files.filter((x) => x.scope === scope)) {
          byRef.set(f.ref, { ...f.file, ref: f.ref, scope });
        }
      }
      return Promise.resolve({ agents: [...byRef.values()], diagnostics: [] });
    },
  };
}

/** Wait one animation frame — the coalesced turn-flush lands on the next
 *  `requestAnimationFrame` (a subsequent `status` push flushes synchronously instead). */
function flushRaf(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** A bridge whose push listener this test can drive directly. */
function pushable(over: Partial<ConsoleBridge> = {}) {
  let emit: ((payload: unknown) => void) | undefined;
  const bridge = fakeBridge({
    ...over,
    onPush: vi.fn((listener: (payload: unknown) => void) => {
      emit = listener;
      return () => {};
    }),
  });
  return { bridge, emit: (p: unknown) => emit?.(p) };
}

// --- Slice readers: the contract is asserted on store state, not on a published blob ---
const data = () => useDaemonData.getState();
const sessions = () => useSessions.getState();
const ui = () => useConsoleUi.getState();
const transcriptOf = (id: string) => useTranscripts.getState().bySession[id];
/** The ACTIVE session's transcript entry — what the chat surface renders. */
const activeTurns = () => {
  const id = sessions().activeSessionId;
  return id === undefined ? undefined : transcriptOf(id);
};
const activeFrames = (): TurnFrame[] => {
  const entry = activeTurns();
  if (entry?.status !== 'ok') throw new Error('active transcript is not materialized');
  return entry.value;
};

const controllers: ConsoleController[] = [];

/** Mount the controller against the slice stores (reset in beforeEach). */
async function mount(bridge = fakeBridge()) {
  const navigate = vi.fn<(surface: string) => void>();
  const controller = await startConsole(bridge, { navigate });
  controllers.push(controller);
  // Flush the fire-and-forget initial loads (accounts / models / sessions+transcript).
  await tick();
  return { controller, navigate, bridge };
}

beforeEach(() => {
  resetTranscripts();
  resetSessions();
  resetDaemonData();
  resetConsoleUi();
  resetActions();
  useNotices.setState({ notice: undefined });
  useShell.setState({ tabs: [], closedTabs: [] });
});

afterEach(() => {
  // Controllers hold live useShell/push subscriptions — a leaked one would keep writing
  // the shared stores from a previous test's bridge.
  for (const c of controllers.splice(0)) c.dispose();
  onAuthFailure(() => {});
});

describe('modelSwitchNoteText', () => {
  const MODELS = [
    { id: 'opus', provider: 'claude', displayName: 'Opus', description: 'Opus 4.8 · smart' },
  ];
  it('labels a known model with its effort', () => {
    expect(
      modelSwitchNoteText({ model: 'opus', reasoning: { mode: 'effort', effort: 'high' } }, MODELS),
    ).toBe('switched to Opus 4.8 · high');
  });
  it('falls back to the raw model id when the descriptor is unknown', () => {
    expect(modelSwitchNoteText({ model: 'mystery-model' }, [])).toBe('switched to mystery-model');
  });
  it('omits the effort segment when no reasoning is set (defensive)', () => {
    expect(modelSwitchNoteText({ model: 'opus' }, MODELS)).toBe('switched to Opus 4.8');
  });
  it('omits the effort segment for an "off" reasoning mode', () => {
    expect(modelSwitchNoteText({ model: 'opus', reasoning: { mode: 'off' } }, MODELS)).toBe(
      'switched to Opus 4.8',
    );
  });
});

describe('detectAuthFailure', () => {
  it('spots auth-shaped error frames and ignores everything else', () => {
    const err = (message: string): TurnFrame => ({
      id: 'e',
      role: 'agent',
      kind: 'error',
      message,
    });
    expect(detectAuthFailure([err('401 Unauthorized')])).toBe(true);
    expect(detectAuthFailure([err('OAuth token expired')])).toBe(true);
    expect(detectAuthFailure([err('rate limit exceeded')])).toBe(false);
    expect(
      detectAuthFailure([{ id: 't', role: 'agent', kind: 'text', text: 'please login' }]),
    ).toBe(false);
  });
});

describe('the controller feeds the slice stores', () => {
  it('shows cap loading then live after refresh', async () => {
    const { controller } = await mount();
    expect(data().cap).toEqual({ status: 'loading' });
    await controller.refresh();
    expect(data().cap).toEqual({ status: 'ok', value: { remaining: 2.5, capHit: false } });
  });

  it('an unchanged poll tick keeps every slow-data reference — and never touches the transcript slice', async () => {
    const { controller } = await mount();
    await controller.refresh();
    const { cap, flags, timeline } = data();
    const transcriptsBefore = useTranscripts.getState().bySession;
    const sessionsBefore = useSessions.getState();
    await controller.refresh();
    expect(data().cap).toBe(cap);
    expect(data().flags).toBe(flags);
    expect(data().timeline).toBe(timeline);
    expect(useTranscripts.getState().bySession).toBe(transcriptsBefore);
    expect(useSessions.getState()).toBe(sessionsBefore);
  });

  it('a changed value at the same status still lands (cap.remaining ticks down)', async () => {
    const capState = vi.fn().mockResolvedValueOnce({ remaining: 2.5, capHit: false });
    const { controller } = await mount(fakeBridge({ capState }));
    await controller.refresh();
    const before = data().cap;
    capState.mockResolvedValueOnce({ remaining: 2.1, capHit: false });
    await controller.refresh();
    expect(data().cap).not.toBe(before);
    expect(data().cap).toEqual({ status: 'ok', value: { remaining: 2.1, capHit: false } });
  });

  it('a poll tick that moves only one key leaves the other two reference-identical', async () => {
    const capState = vi.fn().mockResolvedValue({ remaining: 2.5, capHit: false });
    const { controller } = await mount(fakeBridge({ capState }));
    await controller.refresh();
    const { flags, timeline } = data();
    capState.mockResolvedValue({ remaining: 1.9, capHit: false });
    await controller.refresh();
    expect(data().cap).toEqual({ status: 'ok', value: { remaining: 1.9, capHit: false } });
    expect(data().flags).toBe(flags);
    expect(data().timeline).toBe(timeline);
  });

  it('a polled timeline array gaining an entry at the same status still lands', async () => {
    const listTimeline = vi.fn().mockResolvedValueOnce([]);
    const { controller } = await mount(fakeBridge({ listTimeline }));
    await controller.refresh();
    const entry = {
      id: 'chk1',
      seq: 0,
      ts: '2026-08-01T00:00:00Z',
      worktree: '/wt',
      pinned: false,
    };
    listTimeline.mockResolvedValueOnce([entry]);
    await controller.refresh();
    expect(data().timeline).toEqual({ status: 'ok', value: [entry] });
  });

  it('loads the reloaded persisted conversation transcript on mount', async () => {
    await mount();
    expect(activeTurns()).toEqual({
      status: 'ok',
      value: [
        { id: 'c1:0', role: 'you', kind: 'text', text: 'Refactor the auth module' },
        { id: 'c1:1', role: 'agent', kind: 'text', text: 'on it' },
      ],
    });
  });

  it('shows a transcript the daemon could not fully read as incomplete, not as the whole record', async () => {
    await mount(
      fakeBridge({ reloadConversation: vi.fn().mockResolvedValue(reloaded(FAKE_TURNS, 2)) }),
    );
    const turns = activeFrames();
    expect(turns).toHaveLength(FAKE_TURNS.length + 1);
    expect(turns.at(-1)).toMatchObject({ role: 'system', kind: 'text' });
    expect(JSON.stringify(turns.at(-1))).toContain('2 unreadable events');
  });

  it('loads the model-info catalog and the worktree dock rows at boot', async () => {
    const bridge = fakeBridge({
      modelMetadata: vi.fn().mockResolvedValue({
        entries: [{ id: 'opus', provider: 'claude', contextWindow: 200_000 }],
      }),
      listWorktrees: vi.fn().mockResolvedValue({
        worktrees: [{ sessionId: 'child-1', path: '/wt/child-1', dirty: false, live: true }],
      }),
    });
    await mount(bridge);
    expect(data().modelMetadata).toEqual({
      status: 'ok',
      value: [{ id: 'opus', provider: 'claude', contextWindow: 200_000 }],
    });
    expect(data().worktrees).toEqual({
      status: 'ok',
      value: [{ sessionId: 'child-1', path: '/wt/child-1', dirty: false, live: true }],
    });
  });
});

describe('push routing', () => {
  it('renders a live turn for the active session', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    expect(() =>
      emit({
        kind: 'turn',
        sessionId: 'c1',
        worktree: 'w',
        seq: 2,
        frame: { t: 'text', text: 'hi' },
      }),
    ).not.toThrow();
    await flushRaf();
    expect(activeFrames()).toContainEqual(expect.objectContaining({ text: 'hi' }));
  });

  it('routes pushes by sessionId — background output lands in ITS transcript, leaks into none, and leaves the active entry reference untouched', async () => {
    const { bridge, emit } = pushable({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 's-active',
          agentRef: 'roles/reviewer',
          title: 'active',
          updatedAt: '2026-07-02T00:00:00Z',
        },
        {
          id: 's-bg',
          agentRef: 'roles/reviewer',
          title: 'background',
          updatedAt: '2026-07-01T00:00:00Z',
        },
      ]),
      reloadConversation: vi.fn().mockResolvedValue(reloaded([])),
    });
    await mount(bridge);
    expect(activeTurns()).toEqual({ status: 'ok', value: [] });
    const activeBefore = transcriptOf('s-active');

    emit({
      kind: 'turn',
      sessionId: 's-bg',
      worktree: 'wt',
      seq: 1,
      frame: { t: 'text', text: 'background output' },
    });
    await flushRaf();
    // Not in the active transcript…
    expect(activeTurns()).toEqual({ status: 'ok', value: [] });
    expect(transcriptOf('s-active')).toBe(activeBefore);
    expect(sessions().activeSessionId).toBe('s-active');
    // …but MATERIALIZED in its own session's entry, live while backgrounded.
    expect(transcriptOf('s-bg')).toEqual({
      status: 'ok',
      value: [expect.objectContaining({ text: 'background output' })],
    });
  });

  it('ignores a malformed push (validated at the edge, never throws)', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    expect(() => emit({ kind: 'not-a-real-kind' })).not.toThrow();
  });

  it('unsubscribes from the push stream on dispose', async () => {
    const unsubscribe = vi.fn();
    const bridge = fakeBridge({ onPush: vi.fn().mockReturnValue(unsubscribe) });
    const { controller } = await mount(bridge);
    controller.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('stops materializing tabs after dispose — a torn-down controller writes nothing more', async () => {
    const bridge = fakeBridge({
      listSessions: vi.fn().mockResolvedValue([
        ...FAKE_SESSIONS,
        {
          id: 'c2',
          agentRef: 'roles/reviewer',
          title: 'second',
          updatedAt: '2026-07-01T00:00:00Z',
        },
      ]),
    });
    const { controller } = await mount(bridge);
    controller.dispose();
    useShell.getState().openTab('c2');
    await tick();
    expect(bridge.subscribeSession).not.toHaveBeenCalledWith({ id: 'c2' });
  });

  it('an auth-shaped error push fires the registered auth-failure sink; others do not', async () => {
    const sink = vi.fn();
    onAuthFailure(sink);
    const { bridge, emit } = pushable();
    await mount(bridge);

    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 0,
      frame: { t: 'error', message: '401 Unauthorized', origin: 'loop' },
    });
    expect(sink).toHaveBeenCalledTimes(1);

    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 1,
      frame: { t: 'error', message: 'rate limit exceeded', origin: 'loop' },
    });
    expect(sink).toHaveBeenCalledTimes(1); // non-auth errors never fire it
  });

  it('does not fire the sink for a session pinned to a non-claude provider; a default/claude session still does', async () => {
    const sink = vi.fn();
    onAuthFailure(sink);
    const { bridge, emit } = pushable({
      listSessions: vi.fn().mockResolvedValue([
        ...FAKE_SESSIONS,
        {
          id: 'c2',
          agentRef: 'roles/reviewer',
          title: 'other-backend session',
          updatedAt: '2026-07-02T00:00:00Z',
          provider: 'deepseek',
        },
      ]),
    });
    await mount(bridge);

    emit({
      kind: 'turn',
      sessionId: 'c2',
      worktree: 'w',
      seq: 0,
      frame: { t: 'error', message: '401 Unauthorized', origin: 'loop' },
    });
    expect(sink).not.toHaveBeenCalled();

    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 1,
      frame: { t: 'error', message: '401 Unauthorized', origin: 'loop' },
    });
    expect(sink).toHaveBeenCalledTimes(1);
  });
});

describe('run status', () => {
  it('keeps the pill running across a status running push and a following turn frame', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    expect(sessions().runStatus['c1']).toBeDefined();
    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 0,
      frame: { t: 'text', text: 'hi' },
    });
    await flushRaf();
    expect(sessions().runStatus['c1']).toBeDefined();
  });

  it('clears the pill on a status done push', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'done' });
    expect(sessions().runStatus['c1']).toBeUndefined();
  });

  it('clears the pill on a status error push', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'error' });
    expect(sessions().runStatus['c1']).toBeUndefined();
  });

  it('a blocked-approval status keeps the turn claimed and its elapsed clock unmoved — Stop must stay live through an ask', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    const since = sessions().runStatus['c1']?.since;
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'blocked-approval' });
    expect(sessions().runStatus['c1']?.since).toBe(since);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'blocked-tool' });
    expect(sessions().runStatus['c1']?.since).toBe(since);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'done' });
    expect(sessions().runStatus['c1']).toBeUndefined();
  });

  it('a terminal status flushes buffered stream frames synchronously first', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 2,
      frame: { t: 'text', text: 'last words' },
    });
    // No rAF wait: the status push must land the buffered frame itself.
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'done' });
    expect(activeFrames()).toContainEqual(expect.objectContaining({ text: 'last words' }));
  });

  it('hydrates the pill from the daemon on connect (reattach), not from local send-tracking', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    expect(bridge.subscribeSession).toHaveBeenCalledWith({ id: 'c1' });
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    expect(sessions().runStatus['c1']).toBeDefined();
    expect(bridge.startSession).not.toHaveBeenCalled();
  });

  it('clears the pill when the dispatch itself fails, and says why in the transcript', async () => {
    const bridge = fakeBridge({ startSession: vi.fn().mockRejectedValue(new Error('boom')) });
    await mount(bridge);
    consoleActions.sendMessage('add tests');
    await tick();
    expect(sessions().runStatus['c1']).toBeUndefined();
    await flushRaf();
    expect(activeFrames()).toContainEqual(expect.objectContaining({ text: '⚠ boom' }));
  });
});

describe('instant navigation (the store side of the always-instant contract)', () => {
  const TWO_SESSIONS = [
    ...FAKE_SESSIONS,
    { id: 'c2', agentRef: 'roles/reviewer', title: 'second', updatedAt: '2026-07-01T00:00:00Z' },
  ];

  it('opens the newest session from the daemon and hydrates its state', async () => {
    const { bridge } = await mount();
    expect(bridge.listSessions).toHaveBeenCalled();
    expect(bridge.reloadConversation).toHaveBeenCalledWith({ id: 'c1' });
    expect(sessions().activeSessionId).toBe('c1');
    expect(sessions().list).toEqual({ status: 'ok', value: FAKE_SESSIONS });
  });

  it('switches sessions synchronously: the active id flips and loading shows before the reload lands', async () => {
    let resolveReload: (v: unknown) => void = () => {};
    const bridge = fakeBridge({
      listSessions: vi.fn().mockResolvedValue(TWO_SESSIONS),
      reloadConversation: vi
        .fn()
        .mockResolvedValueOnce(reloaded()) // boot-time open (newest = c1)
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              resolveReload = r;
            }),
        ),
    });
    await mount(bridge);
    consoleActions.selectSession('c2');
    // No await: the switch must not wait on the daemon round-trip.
    expect(sessions().activeSessionId).toBe('c2');
    expect(transcriptOf('c2')).toEqual({ status: 'loading' });
    resolveReload(reloaded([{ seq: 0, frame: { t: 'text', text: 'second turn' } }]));
    await tick();
    expect(transcriptOf('c2')?.status).toBe('ok');
  });

  it('re-selecting a warm session is a pure display swap — served from the store, no reload round trip', async () => {
    const bridge = fakeBridge({
      listSessions: vi.fn().mockResolvedValue(TWO_SESSIONS),
      reloadConversation: vi
        .fn()
        .mockResolvedValueOnce(reloaded()) // boot: c1
        .mockResolvedValueOnce(reloaded([{ seq: 0, frame: { t: 'text', text: 'second turn' } }])), // c2
    });
    await mount(bridge);
    consoleActions.selectSession('c2');
    await tick();
    consoleActions.selectSession('c1');
    // c1 is warm — its frames render this same frame, and NO further I/O was issued.
    expect(sessions().activeSessionId).toBe('c1');
    expect(JSON.stringify(activeFrames())).toContain('on it');
    expect(bridge.reloadConversation).toHaveBeenCalledTimes(2);
    expect(bridge.subscribeSession).toHaveBeenCalledTimes(2);
  });

  it('a slow reload lands in ITS OWN session entry — it can never clobber the one the user moved to', async () => {
    let resolveC2: (v: unknown) => void = () => {};
    const bridge = fakeBridge({
      listSessions: vi.fn().mockResolvedValue(TWO_SESSIONS),
      reloadConversation: vi
        .fn()
        .mockResolvedValueOnce(reloaded()) // boot: c1
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              resolveC2 = r;
            }),
        ), // c2 — held
    });
    await mount(bridge);
    consoleActions.selectSession('c2');
    consoleActions.selectSession('c1');
    await tick();
    resolveC2(reloaded([{ seq: 0, frame: { t: 'text', text: 'late c2 turn' } }]));
    await tick();
    expect(sessions().activeSessionId).toBe('c1');
    expect(JSON.stringify(activeFrames())).not.toContain('late c2 turn');
    // The late answer still materialized ITS session, ready for the next switch.
    expect(JSON.stringify(transcriptOf('c2'))).toContain('late c2 turn');
  });

  it('opening a TAB materializes the session before it is ever activated (subscribe + hydrate)', async () => {
    const bridge = fakeBridge({
      listSessions: vi.fn().mockResolvedValue(TWO_SESSIONS),
      reloadConversation: vi
        .fn()
        .mockResolvedValueOnce(reloaded()) // boot: c1
        .mockResolvedValueOnce(reloaded([{ seq: 0, frame: { t: 'text', text: 'second turn' } }])), // c2
    });
    await mount(bridge);
    useShell.getState().openTab('c2');
    await tick();
    expect(bridge.subscribeSession).toHaveBeenCalledWith({ id: 'c2' });
    expect(bridge.reloadConversation).toHaveBeenCalledWith({ id: 'c2' });
    // Materialized while never active — activation later touches no I/O.
    expect(sessions().activeSessionId).toBe('c1');
    expect(JSON.stringify(transcriptOf('c2'))).toContain('second turn');
  });

  it('materializes tabs layout persistence already restored, which the subscription alone would miss', async () => {
    useShell.setState({ tabs: ['c2'], closedTabs: [] });
    const bridge = fakeBridge({ listSessions: vi.fn().mockResolvedValue(TWO_SESSIONS) });
    await mount(bridge);
    expect(bridge.subscribeSession).toHaveBeenCalledWith({ id: 'c2' });
    expect(bridge.reloadConversation).toHaveBeenCalledWith({ id: 'c2' });
  });

  it('a failed cold open surfaces the error and the next activation retries it', async () => {
    const bridge = fakeBridge({
      listSessions: vi.fn().mockResolvedValue(TWO_SESSIONS),
      reloadConversation: vi
        .fn()
        .mockResolvedValueOnce(reloaded()) // boot: c1
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(reloaded([{ seq: 0, frame: { t: 'text', text: 'recovered' } }])),
    });
    await mount(bridge);
    consoleActions.selectSession('c2');
    await tick();
    expect(transcriptOf('c2')).toEqual({ status: 'error', message: 'ECONNREFUSED' });
    consoleActions.selectSession('c2');
    await tick();
    expect(JSON.stringify(transcriptOf('c2'))).toContain('recovered');
  });

  it('deleting a session evicts every per-session record and moves to the newest', async () => {
    const { bridge, emit } = pushable({
      listSessions: vi
        .fn()
        .mockResolvedValueOnce(TWO_SESSIONS)
        .mockResolvedValue(TWO_SESSIONS.filter((s) => s.id !== 'c1')),
      reloadConversation: vi.fn().mockResolvedValue(reloaded()),
    });
    await mount(bridge);
    // Every per-session record the console holds, written the way the app writes it.
    consoleActions.sendMessage('look at this', [{ kind: 'text', name: 'notes.md', text: '# n' }]);
    consoleActions.setSessionModel('c1', { model: 'opus' });
    consoleActions.onBannerAction('c1', 'drift', 'dismiss');
    consoleActions.onBannerAction('c1', 'cache', 'dismiss');
    emit({ kind: 'usage', sessionId: 'c1', tokensIn: 10, tokensOut: 2 });
    emit({ kind: 'mode', sessionId: 'c1', mode: 'edits', effectiveMode: 'edits' });
    emit({ kind: 'approval', requestId: 'r1', sessionId: 'c1', summary: 's', tool: 'Bash' });
    // c1 is itself some parent's child, so it owns a dock row keyed by its own id.
    emit({
      kind: 'turn',
      sessionId: 'parent',
      worktree: 'w',
      seq: 1,
      frame: {
        t: 'subagent-spawn',
        childSessionId: 'c1',
        childWorktree: '/wt/c1',
        agentRef: 'roles/reviewer',
        description: 'look at this',
        isolate: false,
      },
    });
    await tick();
    expect(transcriptOf('c1')?.status).toBe('ok');

    consoleActions.deleteSession('c1');
    await tick();

    expect(transcriptOf('c1')).toBeUndefined();
    const s = sessions();
    expect(s.runStatus['c1']).toBeUndefined();
    expect(s.sendNonce['c1']).toBeUndefined();
    expect(s.usageBySession['c1']).toBeUndefined();
    expect(s.modeBySession['c1']).toBeUndefined();
    expect(s.pendingApprovalsBySession['c1']).toBeUndefined();
    expect(s.subagentStatus['c1']).toBeUndefined();
    const u = ui();
    expect(u.modelOverride['c1']).toBeUndefined();
    expect(u.dismissedDrift['c1']).toBeUndefined();
    expect(u.dismissedCache['c1']).toBeUndefined();
    expect(u.notesBySession['c1']).toBeUndefined();
    expect(s.activeSessionId).toBe('c2');
  });

  it('leaves a surviving child its dock status when the parent is deleted', async () => {
    const { bridge, emit } = pushable({
      listSessions: vi
        .fn()
        .mockResolvedValueOnce(TWO_SESSIONS)
        .mockResolvedValue(TWO_SESSIONS.filter((s) => s.id !== 'c1')),
    });
    await mount(bridge);
    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 1,
      frame: {
        t: 'subagent-spawn',
        childSessionId: 'child-1',
        childWorktree: '/wt/child-1',
        agentRef: 'roles/reviewer',
        description: 'review the diff',
        isolate: false,
      },
    });
    await tick();

    consoleActions.deleteSession('c1');
    await tick();

    // Deleting a conversation removes that record alone — the child is still a real,
    // still-running session, and its state was announced once and is never replayed.
    expect(sessions().subagentStatus['child-1']).toEqual({ state: 'running' });
  });
});

describe('tab memory — the cap over materialized transcripts', () => {
  const TWO_SESSIONS = [
    ...FAKE_SESSIONS,
    { id: 'c2', agentRef: 'roles/reviewer', title: 'second', updatedAt: '2026-07-01T00:00:00Z' },
  ];
  const held = (): string[] => Object.keys(useTranscripts.getState().bySession);

  /** Materialize `count` transcripts nothing has open — the residue a long stretch of
   *  opening and closing conversations leaves behind. Each is warmer than the last. */
  function seedClosedConversations(count: number): void {
    for (let i = 0; i < count; i++) {
      appendFrames(`old-${i}`, [{ id: `old-${i}:0`, role: 'agent', kind: 'text', text: 'x' }]);
      flushFrames();
    }
  }

  /** Drive the store one entry past the cap with c2 open, then closed — so c2 is the
   *  coldest transcript in it and the next working-set change must reap exactly it. */
  async function overflowWithC2Closed(bridge: ConsoleBridge): Promise<void> {
    await mount(bridge);
    useShell.getState().openTab('c2');
    await tick();
    useShell.getState().forgetTab('c2');
    // A closed tab keeps its transcript: reopening it is free while there is room.
    expect(transcriptOf('c2')?.status).toBe('ok');
    seedClosedConversations(TRANSCRIPT_CAP - 1);
    // Only a change in the working set re-checks the cap.
    useShell.getState().openTab('c1');
    await tick();
  }

  it('holds the store to the cap, reaping the coldest transcript no tab has open', async () => {
    const bridge = fakeBridge({ listSessions: vi.fn().mockResolvedValue(TWO_SESSIONS) });
    await overflowWithC2Closed(bridge);
    expect(transcriptOf('c2')).toBeUndefined();
    expect(transcriptOf('c1')?.status).toBe('ok');
    expect(held()).toHaveLength(TRANSCRIPT_CAP);
  });

  it('an evicted session opens again cleanly — the attachment went with it', async () => {
    const bridge = fakeBridge({
      listSessions: vi.fn().mockResolvedValue(TWO_SESSIONS),
      reloadConversation: vi
        .fn()
        .mockResolvedValue(reloaded([{ seq: 0, frame: { t: 'text', text: 'still here' } }])),
    });
    await overflowWithC2Closed(bridge);
    const reloadsBefore = vi.mocked(bridge.reloadConversation).mock.calls.length;

    consoleActions.selectSession('c2');
    await tick();

    // A session still counted as attached would never re-hydrate and would render empty
    // forever; this is a genuine cold open instead.
    expect(vi.mocked(bridge.reloadConversation).mock.calls.length).toBe(reloadsBefore + 1);
    expect(JSON.stringify(transcriptOf('c2'))).toContain('still here');
  });

  it('never evicts an open tab, even with a working set larger than the cap', async () => {
    const tabs = Array.from({ length: TRANSCRIPT_CAP + 5 }, (_, i) => `tab-${i}`);
    await mount(fakeBridge({ listSessions: vi.fn().mockResolvedValue(TWO_SESSIONS) }));

    useShell.setState({ tabs });
    await tick();

    // Every one of them is a mounted host — dropping any would blank a visible tab, so
    // the working set simply exceeds the cap (which bounds what is kept BEYOND it).
    for (const id of tabs) expect(transcriptOf(id)?.status).toBe('ok');
    expect(held()).toHaveLength(tabs.length + 1); // + the active session
  });
});

describe('sends', () => {
  it('sends a composer message into the active session with its conversation id', async () => {
    const { bridge } = await mount();
    consoleActions.sendMessage('add tests');
    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'add tests', conversationId: 'c1' }),
    );
  });

  it('sends the agent selected role list to the daemon', async () => {
    const { bridge } = await mount();
    consoleActions.sendMessage('audit the flow');
    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['researcher'] }),
    );
  });

  it('carries staged attachments through the action delegate and notes them locally', async () => {
    const { bridge } = await mount();
    const attachments = [
      { kind: 'image' as const, mimeType: 'image/png', data: 'aWJt', name: 'shot.png' },
      { kind: 'text' as const, name: 'notes.md', text: '# notes' },
    ];

    consoleActions.sendMessage('what is in this?', attachments);

    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'what is in this?', attachments }),
    );
    // The persisted transcript carries only text, so a console-local note records that
    // the attachments went along (same mechanism as the model-switch note).
    expect(ui().notesBySession['c1']).toEqual([
      expect.objectContaining({ text: 'attached shot.png, notes.md' }),
    ]);
  });

  it('carries explicit skill invocations through the action delegate and notes them locally', async () => {
    const { bridge } = await mount();
    consoleActions.sendMessage('review this', undefined, ['commits', 'writing']);
    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ invokeSkills: ['commits', 'writing'] }),
    );
    expect(ui().notesBySession['c1']).toEqual([
      expect.objectContaining({ text: 'invoked /commits, /writing' }),
    ]);
  });

  it('a plain send carries NO attachments or invokeSkills field — byte-identical to before', async () => {
    const { bridge } = await mount();
    consoleActions.sendMessage('just text');
    const params = vi.mocked(bridge.startSession).mock.calls.at(-1)?.[0];
    expect(params !== undefined && 'attachments' in params).toBe(false);
    expect(params !== undefined && 'invokeSkills' in params).toBe(false);
  });

  it('stages a deliberate model override and clears it once a send applies it (the cache-banner state)', async () => {
    await mount(
      fakeBridge({
        listModels: vi.fn().mockResolvedValue([
          { id: 'deepseek-v4-pro', provider: 'deepseek' },
          { id: 'opus', provider: 'claude' },
        ]),
      }),
    );
    expect(ui().modelOverride['c1']).toBeUndefined();
    consoleActions.setSessionModel('c1', { model: 'deepseek-v4-pro', provider: 'deepseek' });
    expect(ui().modelOverride['c1']).toEqual({ model: 'deepseek-v4-pro', provider: 'deepseek' });
    consoleActions.sendMessage('hi');
    expect(ui().modelOverride['c1']).toBeUndefined();
  });

  it('an in-chat model switch routes the next send to the picked backend', async () => {
    const bridge = fakeBridge({
      listModels: vi.fn().mockResolvedValue([
        { id: 'deepseek-v4-pro', provider: 'deepseek' },
        { id: 'opus', provider: 'claude' },
      ]),
    });
    await mount(bridge);
    consoleActions.setSessionModel('c1', { model: 'deepseek-v4-pro', provider: 'deepseek' });
    consoleActions.sendMessage('hi');
    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: { model: 'deepseek-v4-pro', provider: 'deepseek' } }),
    );
  });

  it('merges a staged effort onto the staged model — a later effort pick never drops the model back to the agent default', async () => {
    const bridge = fakeBridge({
      listModels: vi.fn().mockResolvedValue([
        {
          id: 'deepseek-v4-pro',
          provider: 'deepseek',
          supportsEffort: true,
          supportedEffortLevels: ['low', 'medium', 'high'],
        },
        { id: 'opus', provider: 'claude' },
      ]),
    });
    await mount(bridge);
    consoleActions.setSessionModel('c1', { model: 'deepseek-v4-pro', provider: 'deepseek' });
    consoleActions.setSessionModel('c1', { reasoning: { mode: 'effort', effort: 'high' } });
    consoleActions.sendMessage('hi');
    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {
          model: 'deepseek-v4-pro',
          provider: 'deepseek',
          reasoning: { mode: 'effort', effort: 'high' },
        },
      }),
    );
  });

  it('records a "switched model" note for the applied override, placed after the frames it followed', async () => {
    await mount(
      fakeBridge({
        listModels: vi.fn().mockResolvedValue([
          {
            id: 'opus',
            provider: 'claude',
            displayName: 'Opus',
            description: 'Opus 4.8 · smart',
          },
        ]),
      }),
    );
    consoleActions.setSessionModel('c1', { model: 'opus', provider: 'claude' });
    consoleActions.sendMessage('hi');
    expect(ui().notesBySession['c1']).toEqual([{ afterCount: 2, text: 'switched to Opus 4.8' }]);
  });

  it('settles an interrupted reasoning block and appends the interrupt marker from the daemon frames (live == reload)', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);

    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 2,
      frame: { t: 'thinking-delta', text: 'weighing options' },
    });
    await flushRaf();
    expect(activeFrames()).toContainEqual(
      expect.objectContaining({ kind: 'thinking', text: 'weighing options', streaming: true }),
    );

    // A bare stop: the DAEMON settles the partial (with its measured duration) and records
    // the marker as real, persisted frames, then reports the terminal status. The console
    // just renders them — it never synthesizes closure of its own.
    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 3,
      frame: { t: 'thinking', text: 'weighing options', durationMs: 3000 },
    });
    emit({ kind: 'turn', sessionId: 'c1', worktree: 'w', seq: 4, frame: { t: 'interrupted' } });
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'interrupted' });

    const thinkingBlocks = activeFrames().filter((t) => t.kind === 'thinking');
    expect(thinkingBlocks).toHaveLength(1);
    expect(thinkingBlocks[0]).toMatchObject({ durationMs: 3000 });
    expect(activeFrames().some((t) => t.kind === 'interrupted')).toBe(true);
  });

  it('interruptSession proxies the Stop affordance to the bridge for the active session', async () => {
    const { bridge } = await mount();
    consoleActions.interruptSession('c1');
    expect(bridge.interruptSession).toHaveBeenCalledExactlyOnceWith({ id: 'c1' });
  });

  it('sends a steer with no mode, since a steer never abandons the running turn', async () => {
    const calls: unknown[] = [];
    const bridge = fakeBridge({
      steerSession: vi.fn((params: unknown) => {
        calls.push(params);
        return Promise.resolve({ steered: true });
      }),
    });
    await mount(bridge);
    consoleActions.steerSession('c1', 'use the JSON one');
    expect(calls).toEqual([{ id: 'c1', text: 'use the JSON one' }]);
  });

  it('steerSession does NOT render optimistically — the daemon pushes the framed line on pickup', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    const before = activeTurns();

    consoleActions.steerSession('c1', 'go check the tests instead');
    expect(bridge.steerSession).toHaveBeenCalledExactlyOnceWith({
      id: 'c1',
      text: 'go check the tests instead',
    });
    expect(activeTurns()).toBe(before);

    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: '/wt',
      seq: 7,
      frame: {
        t: 'text',
        text: '[The user interrupted to steer you] go check the tests instead',
        role: 'user',
      },
    });
    await flushRaf();
    expect(activeFrames()).toContainEqual(
      expect.objectContaining({
        text: '[The user interrupted to steer you] go check the tests instead',
      }),
    );
  });

  it('toggles raw mode', async () => {
    const { controller } = await mount();
    expect(ui().rawMode).toBe(false);
    controller.toggleRaw();
    expect(ui().rawMode).toBe(true);
  });
});

describe('per-turn usage', () => {
  it('a usage push lands on its session for the context ring (last settle wins)', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);

    emit({ kind: 'usage', sessionId: 'c1', tokensIn: 30_000, tokensOut: 1_200 });
    expect(sessions().usageBySession['c1']).toEqual({ tokensIn: 30_000, tokensOut: 1_200 });

    // A later settle REPLACES (its tokensIn already includes the whole context).
    emit({
      kind: 'usage',
      sessionId: 'c1',
      tokensIn: 42_000,
      tokensOut: 900,
      cacheReadTokens: 8_000,
    });
    expect(sessions().usageBySession['c1']).toEqual({
      tokensIn: 42_000,
      tokensOut: 900,
      cacheReadTokens: 8_000,
    });
  });

  it('routes a usage push by sessionId — a background settle never leaks onto the active ring', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({ kind: 'usage', sessionId: 'c-other', tokensIn: 5, tokensOut: 5 });
    expect(sessions().usageBySession['c1']).toBeUndefined();
    expect(sessions().usageBySession['c-other']).toEqual({ tokensIn: 5, tokensOut: 5 });
  });
});

describe('permission modes', () => {
  it('setPermissionMode proxies the switch to the bridge for the given session', async () => {
    const { bridge } = await mount();
    consoleActions.setPermissionMode('c1', 'plan');
    expect(bridge.setMode).toHaveBeenCalledExactlyOnceWith({ id: 'c1', mode: 'plan' });
  });

  it("a mode push reflects the session's live permission-mode state", async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({ kind: 'mode', sessionId: 'c1', mode: 'edits', effectiveMode: 'edits' });
    expect(sessions().modeBySession['c1']).toEqual({ mode: 'edits', effectiveMode: 'edits' });
  });

  it('a degraded mode push carries its honest reason through untouched', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({
      kind: 'mode',
      sessionId: 'c1',
      mode: 'plan',
      effectiveMode: 'bypass',
      degraded: 'the active backend has no approval seam — enforcement degrades to bypass',
    });
    expect(sessions().modeBySession['c1']).toEqual({
      mode: 'plan',
      effectiveMode: 'bypass',
      degraded: 'the active backend has no approval seam — enforcement degrades to bypass',
    });
  });

  it('an approval push queues a live pending ask for its session', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({
      kind: 'approval',
      requestId: 'r1',
      sessionId: 'c1',
      summary: 'write auth.ts',
      tool: 'write_file',
      toolClass: 'write',
    });
    expect(sessions().pendingApprovalsBySession['c1']).toEqual([
      { requestId: 'r1', tool: 'write_file', summary: 'write auth.ts', toolClass: 'write' },
    ]);
  });

  it('queues concurrent asks oldest-first, so neither overwrites the other', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({ kind: 'approval', requestId: 'r1', sessionId: 'c1', summary: 'first', tool: 'Bash' });
    emit({ kind: 'approval', requestId: 'r2', sessionId: 'c1', summary: 'second', tool: 'Bash' });
    expect(sessions().pendingApprovalsBySession['c1']?.map((p) => p.requestId)).toEqual([
      'r1',
      'r2',
    ]);
  });

  it('respondApproval answers a live pending ask over the real RPC and clears it optimistically', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({
      kind: 'approval',
      requestId: 'r1',
      sessionId: 'c1',
      summary: 'write auth.ts',
      tool: 'write_file',
    });
    expect(sessions().pendingApprovalsBySession['c1']).toHaveLength(1);

    consoleActions.respondApproval('r1', 'approve');
    expect(bridge.respondApproval).toHaveBeenCalledExactlyOnceWith({
      id: 'c1',
      requestId: 'r1',
      decision: 'approve',
    });
    expect(sessions().pendingApprovalsBySession['c1']).toEqual([]);
  });

  it('a terminal status push drops any pending ask still queued for that session — Stop mid-ask must never gate-lock the composer forever', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({
      kind: 'approval',
      requestId: 'r1',
      sessionId: 'c1',
      summary: 'run tests',
      tool: 'Bash',
      toolClass: 'exec',
    });
    expect(sessions().pendingApprovalsBySession['c1']).toHaveLength(1);

    // The turn that raised the ask just stopped — the daemon fail-safe-denies its own
    // copy on this exact transition, but only THIS console-side clear stops the composer
    // from staying gate-locked on a request nothing could ever answer.
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'interrupted' });
    expect(sessions().pendingApprovalsBySession['c1']).toBeUndefined();
  });

  it('a running status push leaves a live pending ask alone', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({
      kind: 'approval',
      requestId: 'r1',
      sessionId: 'c1',
      summary: 'run tests',
      tool: 'Bash',
    });
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    expect(sessions().pendingApprovalsBySession['c1']).toHaveLength(1);
  });

  it('leaves the live pending queue untouched, and never calls the RPC, for an id that is not a genuinely live request', async () => {
    const { bridge } = await mount();
    consoleActions.respondApproval('frame-only-id', 'deny');
    expect(bridge.respondApproval).not.toHaveBeenCalled();
    // The pre-existing local overlay (transcript-frame-derived approvals — dev/test data
    // only) still resolves it, unaffected.
    expect(ui().resolvedApprovals['frame-only-id']).toBe('denied');
  });

  it("hydrates a session's permission-mode state on open/reattach from sessionMode", async () => {
    const bridge = fakeBridge({
      sessionMode: vi.fn().mockResolvedValue({
        found: true,
        mode: 'edits',
        effectiveMode: 'edits',
        pending: [{ requestId: 'r1', tool: 'bash', summary: 'run tests', input: {} }],
      }),
    });
    await mount(bridge);
    expect(bridge.sessionMode).toHaveBeenCalledWith({ id: 'c1' });
    expect(sessions().modeBySession['c1']).toEqual({ mode: 'edits', effectiveMode: 'edits' });
    expect(sessions().pendingApprovalsBySession['c1']).toEqual([
      { requestId: 'r1', tool: 'bash', summary: 'run tests', input: {} },
    ]);
  });

  it('hydration synthesizes the honest degraded reason when the snapshot itself is already degraded', async () => {
    const bridge = fakeBridge({
      sessionMode: vi.fn().mockResolvedValue({
        found: true,
        mode: 'plan',
        effectiveMode: 'bypass',
        pending: [],
      }),
    });
    await mount(bridge);
    expect(sessions().modeBySession['c1']).toMatchObject({ mode: 'plan', effectiveMode: 'bypass' });
    expect(sessions().modeBySession['c1']?.degraded).toBeDefined();
  });

  it("a background tab's mode hydration lands in ITS keys, whatever the user switched to meanwhile", async () => {
    const TWO_SESSIONS = [
      ...FAKE_SESSIONS,
      { id: 'c2', agentRef: 'roles/reviewer', title: 'second', updatedAt: '2026-07-01T00:00:00Z' },
    ];
    let resolveC2: (v: unknown) => void = () => {};
    const bridge = fakeBridge({
      listSessions: vi.fn().mockResolvedValue(TWO_SESSIONS),
      sessionMode: vi
        .fn()
        .mockResolvedValueOnce({ found: true, mode: 'plan', effectiveMode: 'plan', pending: [] })
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              resolveC2 = r;
            }),
        ),
    });
    await mount(bridge);
    consoleActions.selectSession('c2');
    consoleActions.selectSession('c1');
    resolveC2({ found: true, mode: 'edits', effectiveMode: 'edits', pending: [] });
    await tick();
    expect(sessions().modeBySession['c1']).toMatchObject({ mode: 'plan' });
    expect(sessions().modeBySession['c2']).toMatchObject({ mode: 'edits' });
  });
});

describe('subagent announcements — the parent-stream mirror', () => {
  it('mirrors spawn→running and completion→reason, refreshing the session + worktree reads', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    const listWorktrees = vi.mocked(bridge.listWorktrees);
    const listSessions = vi.mocked(bridge.listSessions);
    const worktreeReadsBefore = listWorktrees.mock.calls.length;
    const sessionReadsBefore = listSessions.mock.calls.length;

    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 5,
      frame: {
        t: 'subagent-spawn',
        childSessionId: 'child-1',
        childWorktree: '/repo/.coa/worktrees/child-1',
        agentRef: 'roles/reviewer',
        description: 'review the diff',
        isolate: true,
      },
    });
    // The slice write is synchronous — the dock agrees before the transcript repaints.
    expect(sessions().subagentStatus['child-1']).toEqual({ state: 'running' });
    await tick();
    // A spawn is a new rail row and (isolated) a new worktree — both reads re-run.
    expect(listSessions.mock.calls.length).toBeGreaterThan(sessionReadsBefore);
    expect(listWorktrees.mock.calls.length).toBeGreaterThan(worktreeReadsBefore);

    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 6,
      frame: {
        t: 'subagent-completion',
        childSessionId: 'child-1',
        childWorktree: '/repo/.coa/worktrees/child-1',
        agentRef: 'roles/reviewer',
        reason: 'errored',
        detail: 'rate limited',
      },
    });
    await tick();
    expect(sessions().subagentStatus['child-1']).toEqual({ state: 'errored' });
  });

  it('an announcement never lands on a hydrated turn’s id, however the two are numbered', async () => {
    // The session host numbers live-only announcements on a counter of their own, which
    // starts at 0 — the very number this conversation's first persisted turn already
    // holds. Two frames under one id means two React rows keyed the same.
    const { bridge, emit } = pushable({
      reloadConversation: vi.fn().mockResolvedValue(
        reloaded([
          { seq: 0, frame: { t: 'text', text: 'spawn a reviewer', role: 'user' } },
          { seq: 1, frame: { t: 'text', text: 'on it' } },
          { seq: 2, frame: { t: 'text', text: 'done' } },
        ]),
      ),
    });
    await mount(bridge);

    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 0,
      live: true,
      frame: {
        t: 'subagent-spawn',
        childSessionId: 'child-1',
        childWorktree: '/repo/.coa/worktrees/child-1',
        agentRef: 'roles/reviewer',
        description: 'review the diff',
        isolate: false,
      },
    });
    flushFrames();

    const ids = activeFrames().map((f) => f.id);
    expect(ids).toEqual(['c1:0', 'c1:1', 'c1:2', 'live:c1:0']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('an ordinary turn frame re-reads nothing — only announcements invalidate the rail', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    const listSessions = vi.mocked(bridge.listSessions);
    const readsBefore = listSessions.mock.calls.length;
    emit({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 3,
      frame: { t: 'text', text: 'ordinary output' },
    });
    await tick();
    expect(listSessions.mock.calls.length).toBe(readsBefore);
  });

  it('reapWorktree surfaces a running refusal as a notice and re-reads on success', async () => {
    const reap = vi
      .fn()
      .mockResolvedValueOnce({ reaped: false, reason: 'running' })
      .mockResolvedValueOnce({ reaped: true });
    const bridge = fakeBridge({ reapWorktree: reap });
    await mount(bridge);
    const listWorktrees = vi.mocked(bridge.listWorktrees);
    const readsBefore = listWorktrees.mock.calls.length;

    consoleActions.reapWorktree('child-1');
    await tick();
    // Refused ⇒ no re-read, and the refusal is said out loud (a notice, never a block).
    expect(listWorktrees.mock.calls.length).toBe(readsBefore);
    expect(useNotices.getState().notice?.title).toBe('Nothing reaped');
    expect(useNotices.getState().notice?.detail).toContain('still running');

    consoleActions.reapWorktree('child-1');
    await tick();
    expect(listWorktrees.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(reap).toHaveBeenCalledTimes(2);
  });
});

describe('agents', () => {
  it('surfaces the listAgents envelope’s load diagnostics — a broken agent file is reported, not silently absent', async () => {
    const diagnostic = {
      scope: 'personal' as const,
      ref: 'scratch',
      path: '/home/.coa/agents/scratch.yaml',
      problem: 'invalid' as const,
      detail: 'missing required field: description',
    };
    await mount(
      fakeBridge({
        listAgents: vi.fn().mockResolvedValue({ agents: MOCK_AGENTS, diagnostics: [diagnostic] }),
      }),
    );
    expect(data().agentDiagnostics).toEqual([diagnostic]);
  });

  it('creates an agent, persists it through saveAgent, and rehydrates it on a simulated reload', async () => {
    const disk = new Map<string, { scope: 'personal' | 'project'; file: AgentFile }>();
    const readDisk = (): Promise<{ agents: AgentSummary[]; diagnostics: never[] }> =>
      Promise.resolve({
        agents: [...disk].map(([ref, { scope, file }]) => ({ ...file, ref, scope })),
        diagnostics: [],
      });
    const saveAgent = vi
      .fn()
      .mockImplementation((p: { ref: string; scope: 'personal' | 'project'; file: AgentFile }) => {
        disk.set(p.ref, { scope: p.scope, file: p.file });
        return Promise.resolve({ ok: true });
      });

    const bridge1 = fakeBridge({ listAgents: vi.fn().mockImplementation(readDisk), saveAgent });
    await mount(bridge1);
    expect(data().agents).toEqual({ status: 'ok', value: [] });

    consoleActions.createAgent('personal');
    expect(saveAgent).toHaveBeenCalledWith({
      ref: 'untitled-agent',
      scope: 'personal',
      file: expect.objectContaining({ name: 'untitled-agent' }),
    });
    const created = data().agents;
    expect(created.status).toBe('ok');
    if (created.status === 'ok') {
      expect(created.value).toHaveLength(1);
      expect(created.value[0]?.ref).toBe('untitled-agent');
    }

    // A reload (fresh controller over the shared registry) rehydrates what was written.
    resetDaemonData();
    const bridge2 = fakeBridge({ listAgents: vi.fn().mockImplementation(readDisk) });
    await mount(bridge2);
    const rehydrated = data().agents;
    expect(rehydrated.status).toBe('ok');
    if (rehydrated.status === 'ok') {
      expect(rehydrated.value).toHaveLength(1);
      expect(rehydrated.value[0]?.ref).toBe('untitled-agent');
    }
  });

  it('updateAgent writes the merged agent through saveAgent at its current scope', async () => {
    const saveAgent = vi.fn().mockResolvedValue({ ok: true });
    await mount(fakeBridge({ saveAgent }));
    consoleActions.updateAgent('roles/reviewer', { name: 'sec-reviewer' });
    expect(saveAgent).toHaveBeenCalledWith({
      ref: 'roles/reviewer',
      scope: 'project',
      file: expect.objectContaining({ name: 'sec-reviewer' }),
    });
    const agents = data().agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      expect(agents.value.find((a) => a.ref === 'roles/reviewer')?.name).toBe('sec-reviewer');
    }
  });

  it('updateAgent moving scope writes the new copy before removing the old one', async () => {
    const saveAgent = vi.fn().mockResolvedValue({ ok: true });
    const deleteAgent = vi.fn().mockResolvedValue({ removed: true });
    await mount(fakeBridge({ saveAgent, deleteAgent }));
    consoleActions.updateAgent('roles/reviewer', { scope: 'personal' });
    await tick();
    expect(saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'roles/reviewer', scope: 'personal' }),
    );
    expect(deleteAgent).toHaveBeenCalledWith({ ref: 'roles/reviewer', scope: 'project' });
    const saveOrder = saveAgent.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    const deleteOrder = deleteAgent.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    expect(saveOrder).toBeLessThan(deleteOrder);
  });

  it('updateAgent keeps the agent file when the second write of a scope move fails', async () => {
    const disk = fakeAgentDisk(MOCK_AGENTS);
    let writes = 0;
    const failSecondWrite = <P>(op: (p: P) => Promise<unknown>) =>
      vi.fn((p: P) => (++writes === 2 ? Promise.reject(new Error('EIO')) : op(p)));
    await mount(
      fakeBridge({
        listAgents: vi.fn(disk.listAgents),
        saveAgent: failSecondWrite(disk.saveAgent),
        deleteAgent: failSecondWrite(disk.deleteAgent),
      }),
    );
    expect(disk.scopesOf('roles/reviewer')).toEqual(['project']);

    consoleActions.updateAgent('roles/reviewer', { scope: 'personal' });
    await tick();

    expect(disk.scopesOf('roles/reviewer')).toContain('personal');
    expect(disk.scopesOf('roles/reviewer').length).toBeGreaterThan(0);
    const agents = data().agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      const rows = agents.value.filter((a) => a.ref === 'roles/reviewer');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.scope).toBe('project');
    }
  });

  it('updateAgent rolls the edit back and re-reads the registry when the save fails', async () => {
    const bridge = fakeBridge({ saveAgent: vi.fn().mockRejectedValue(new Error('EACCES')) });
    await mount(bridge);
    expect(bridge.listAgents).toHaveBeenCalledTimes(1);

    consoleActions.updateAgent('roles/reviewer', { name: 'sec-reviewer' });
    await tick();

    const agents = data().agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      expect(agents.value.find((a) => a.ref === 'roles/reviewer')?.name).toBe('reviewer');
    }
    expect(bridge.listAgents).toHaveBeenCalledTimes(2);
  });

  it('createAgent takes the optimistic row back down when the save fails', async () => {
    const bridge = fakeBridge({ saveAgent: vi.fn().mockRejectedValue(new Error('ENOSPC')) });
    await mount(bridge);
    const selectedBefore = ui().selectedAgentRef;

    consoleActions.createAgent('personal');
    await tick();

    const agents = data().agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      expect(agents.value.some((a) => a.ref === 'untitled-agent')).toBe(false);
    }
    expect(ui().selectedAgentRef).toBe(selectedBefore);
    expect(bridge.listAgents).toHaveBeenCalledTimes(2);
  });

  it('deleteAgent puts the row and the selection back when the delete fails', async () => {
    const bridge = fakeBridge({ deleteAgent: vi.fn().mockRejectedValue(new Error('EBUSY')) });
    await mount(bridge);
    consoleActions.selectAgent('personal/scratch-helper');

    consoleActions.deleteAgent('personal/scratch-helper');
    await tick();

    const agents = data().agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      expect(agents.value.some((a) => a.ref === 'personal/scratch-helper')).toBe(true);
    }
    expect(ui().selectedAgentRef).toBe('personal/scratch-helper');
    expect(bridge.listAgents).toHaveBeenCalledTimes(2);
  });

  it('updateAgent refuses a builtin agent — it never reaches the bridge', async () => {
    const saveAgent = vi.fn();
    await mount(
      fakeBridge({
        listAgents: vi.fn().mockResolvedValue({
          agents: [
            { ref: 'general-purpose', name: 'General purpose', description: 'd', scope: 'builtin' },
          ],
          diagnostics: [],
        }),
        saveAgent,
      }),
    );
    consoleActions.updateAgent('general-purpose', { name: 'renamed' });
    expect(saveAgent).not.toHaveBeenCalled();
    const agents = data().agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') expect(agents.value[0]?.name).toBe('General purpose');
  });

  it('deleteAgent proxies the agent’s own scope to the daemon delete', async () => {
    const deleteAgent = vi.fn().mockResolvedValue({ removed: true });
    await mount(fakeBridge({ deleteAgent }));
    consoleActions.deleteAgent('personal/scratch-helper');
    expect(deleteAgent).toHaveBeenCalledWith({ ref: 'personal/scratch-helper', scope: 'personal' });
    const agents = data().agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      expect(agents.value.some((a) => a.ref === 'personal/scratch-helper')).toBe(false);
    }
  });

  it('deleteAgent refuses a builtin agent — it never reaches the bridge', async () => {
    const deleteAgent = vi.fn();
    await mount(
      fakeBridge({
        listAgents: vi.fn().mockResolvedValue({
          agents: [
            { ref: 'general-purpose', name: 'General purpose', description: 'd', scope: 'builtin' },
          ],
          diagnostics: [],
        }),
        deleteAgent,
      }),
    );
    consoleActions.deleteAgent('general-purpose');
    expect(deleteAgent).not.toHaveBeenCalled();
    const agents = data().agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') expect(agents.value).toHaveLength(1);
  });
});

describe('boot and hydrate', () => {
  it('hydrate() recovers reads that failed at cold boot (daemon not up yet when startConsole fired them)', async () => {
    const bridge = fakeBridge({
      listAccounts: vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue({ accounts: [{ label: 'acct', provider: 'claude' }], active: {} }),
      listSessions: vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue(FAKE_SESSIONS),
      listAgents: vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue({ agents: MOCK_AGENTS, diagnostics: [] }),
      listWorktrees: vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue({ worktrees: [] }),
    });
    const { controller } = await mount(bridge);

    expect(data().accounts.status).toBe('error');
    expect(sessions().list.status).toBe('error');
    expect(data().worktrees.status).toBe('error');
    // listAgents' rejection degrades to the empty floor (never a mock, never an error
    // status), so the only observable symptom pre-hydrate is an empty list.
    expect(data().agents).toEqual({ status: 'ok', value: [] });
    expect(sessions().activeSessionId).toBeUndefined();

    await controller.hydrate();

    expect(data().accounts).toEqual({
      status: 'ok',
      value: { accounts: [{ label: 'acct', provider: 'claude' }], active: {} },
    });
    expect(sessions().list).toEqual({ status: 'ok', value: FAKE_SESSIONS });
    expect(data().agents).toEqual({ status: 'ok', value: MOCK_AGENTS });
    expect(data().worktrees).toEqual({ status: 'ok', value: [] });
    expect(sessions().activeSessionId).toBe('c1');
  });

  it('hydrate() fired immediately after startup dedupes against the in-flight boot loads (ordinary launch race)', async () => {
    const bridge = fakeBridge();
    const controller = await startConsole(bridge, { navigate: vi.fn() });
    controllers.push(controller);

    // No boot-flush wait: hydrate races the fire-and-forget boot loads deliberately.
    await controller.hydrate();
    await tick();

    expect(bridge.listSessions).toHaveBeenCalledTimes(1);
    expect(bridge.reloadConversation).toHaveBeenCalledTimes(1);
    expect(bridge.subscribeSession).toHaveBeenCalledTimes(1);
  });

  it('hydrate() does not re-run initSessions when reads are already ok and a session is active (a mid-use daemon restart)', async () => {
    const bridge = fakeBridge();
    const { controller } = await mount(bridge);
    expect(sessions().activeSessionId).toBe('c1');

    vi.mocked(bridge.listSessions).mockClear();

    await controller.hydrate();

    expect(bridge.listSessions).not.toHaveBeenCalled();
    expect(sessions().activeSessionId).toBe('c1');
  });

  it('hydrate() after a daemon restart re-attaches the active session, so a dead session’s stale pill clears', async () => {
    // The wedge this kills: daemon dies mid-turn, comes back, the renderer still shows
    // "running" forever because nothing ever re-asks the daemon. On the restart hydrate
    // the reattach runs again and the daemon's refusal clears the claim.
    const subscribeSession = vi
      .fn()
      .mockResolvedValueOnce({ subscribed: true }) // boot attach
      .mockResolvedValue({ subscribed: false }); // the restarted daemon has no session
    const { bridge, emit } = pushable({ subscribeSession });
    const { controller } = await mount(bridge);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    expect(sessions().runStatus['c1']).toBeDefined();

    // What the app does on cameUp: clear blanket claims, then hydrate re-attaches.
    controller.clearRunState();
    await controller.hydrate();
    await tick();

    expect(subscribeSession).toHaveBeenCalledTimes(2);
    expect(sessions().runStatus['c1']).toBeUndefined();
    expect(bridge.reloadConversation).toHaveBeenCalledTimes(2);
  });
});

describe('the daemon is the authority on what is still running', () => {
  it('a reattach the daemon refuses clears the pill whenever its answer lands', async () => {
    let answer!: (value: { subscribed: boolean }) => void;
    const { bridge, emit } = pushable({
      subscribeSession: vi
        .fn()
        .mockReturnValue(new Promise<{ subscribed: boolean }>((r) => (answer = r))),
    });
    await mount(bridge);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    expect(sessions().runStatus['c1']).toBeDefined();

    answer({ subscribed: false });
    await tick();

    expect(sessions().runStatus['c1']).toBeUndefined();
  });

  it('leaves a send issued while the reattach was in flight alone', async () => {
    let answer!: (value: { subscribed: boolean }) => void;
    const bridge = fakeBridge({
      subscribeSession: vi
        .fn()
        .mockReturnValue(new Promise<{ subscribed: boolean }>((r) => (answer = r))),
    });
    await mount(bridge);

    // The user types and sends before the daemon answers — the send is the newer news.
    consoleActions.sendMessage('carry on');
    answer({ subscribed: false });
    await tick();

    expect(sessions().runStatus['c1']).toBeDefined();
  });

  it('a subscribe the daemon accepts leaves run state to the push stream', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });

    consoleActions.selectSession('c1');
    await tick();

    expect(sessions().runStatus['c1']).toBeDefined();
  });

  it('forgets every running claim when a daemon connection comes up, without moving the user', async () => {
    const { bridge, emit } = pushable();
    const { controller } = await mount(bridge);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    emit({ kind: 'status', sessionId: 'c-other', worktree: 'w', state: 'running' });
    expect(Object.keys(sessions().runStatus)).toHaveLength(2);

    controller.clearRunState();

    expect(sessions().runStatus).toEqual({});
    expect(sessions().activeSessionId).toBe('c1');
  });

  it('says so when Stop finds nothing to stop, and drops the claim that said otherwise', async () => {
    const { bridge, emit } = pushable({
      interruptSession: vi.fn().mockResolvedValue({ interrupted: false }),
    });
    await mount(bridge);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });

    consoleActions.interruptSession('c1');
    await tick();

    expect(useNotices.getState().notice).toMatchObject({ title: 'Nothing to stop' });
    expect(sessions().runStatus['c1']).toBeUndefined();
  });

  it('leaves a real stop to the daemon push and says nothing', async () => {
    const { bridge, emit } = pushable();
    await mount(bridge);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });

    consoleActions.interruptSession('c1');
    await tick();

    expect(useNotices.getState().notice).toBeUndefined();
    expect(sessions().runStatus['c1']).toBeDefined();
  });
});

describe('failed writes are said out loud', () => {
  it('announces a conversation that could not be deleted, and leaves the rail alone', async () => {
    const bridge = fakeBridge({
      deleteSession: vi.fn().mockRejectedValue(new Error('conversation is locked')),
    });
    await mount(bridge);

    consoleActions.deleteSession('c1');
    await tick();

    expect(useNotices.getState().notice).toMatchObject({
      title: "Couldn't delete that conversation",
      detail: 'conversation is locked',
    });
    expect(sessions().activeSessionId).toBe('c1');
    // Nothing was deleted, so nothing was evicted either.
    expect(transcriptOf('c1')).toBeDefined();
  });

  it('announces an account switch the daemon refused instead of rejecting into the void', async () => {
    const bridge = fakeBridge({
      useAccount: vi.fn().mockRejectedValue(new Error('no such login')),
    });
    await mount(bridge);
    vi.mocked(bridge.listAccounts).mockClear();

    consoleActions.switchAccount('work', 'claude');
    await tick();

    expect(useNotices.getState().notice).toMatchObject({ title: "Couldn't switch accounts" });
    expect(bridge.listAccounts).not.toHaveBeenCalled();
  });

  it('announces an agent write that failed, on top of snapping the list back', async () => {
    const bridge = fakeBridge({ saveAgent: vi.fn().mockRejectedValue(new Error('read-only')) });
    await mount(bridge);
    const before = data().agents;

    consoleActions.createAgent('project');
    await tick();

    expect(useNotices.getState().notice).toMatchObject({
      title: "Couldn't create that agent",
      detail: 'read-only',
    });
    expect(data().agents).toEqual(before);
  });

  it('keeps the drift banner honest when a recompile fails: the suppression stays put', async () => {
    const bridge = fakeBridge({
      recompilePrompt: vi.fn().mockRejectedValue(new Error('daemon is busy')),
    });
    await mount(bridge);
    consoleActions.onBannerAction('c1', 'drift', 'dismiss');
    await tick();
    const suppressed = ui().dismissedDrift['c1'];

    consoleActions.onBannerAction('c1', 'drift', 'recompile');
    await tick();

    expect(useNotices.getState().notice).toMatchObject({
      title: "Couldn't recompile that prompt",
      detail: 'daemon is busy',
    });
    expect(ui().dismissedDrift['c1']).toBe(suppressed);
  });

  it('clears the drift suppression once the daemon confirms the recompile', async () => {
    await mount();
    consoleActions.onBannerAction('c1', 'drift', 'dismiss');
    await tick();
    expect(ui().dismissedDrift['c1']).toBeDefined();

    consoleActions.onBannerAction('c1', 'drift', 'recompile');
    await tick();

    expect(ui().dismissedDrift['c1']).toBeUndefined();
    expect(useNotices.getState().notice).toBeUndefined();
  });
});

describe('a write the daemon answered but did not carry out is said out loud', () => {
  it('says so when the delete found no file to remove', async () => {
    await mount(fakeBridge({ deleteAgent: vi.fn().mockResolvedValue({ removed: false }) }));
    consoleActions.deleteAgent('personal/scratch-helper');
    await tick();
    expect(useNotices.getState().notice).toMatchObject({ title: 'Nothing to delete' });
  });

  it('stays quiet when the delete actually removed the file', async () => {
    await mount();
    consoleActions.deleteAgent('personal/scratch-helper');
    await tick();
    expect(useNotices.getState().notice).toBeUndefined();
  });

  it('names the removal, not the save, when a scope move cannot delete the old copy', async () => {
    await mount(
      fakeBridge({
        deleteAgent: vi.fn().mockRejectedValue(new Error('EBUSY: file is open elsewhere')),
      }),
    );
    consoleActions.updateAgent('roles/reviewer', { scope: 'personal' });
    await tick();
    expect(useNotices.getState().notice).toMatchObject({
      title: "Couldn't finish moving that agent",
    });
    expect(useNotices.getState().notice?.detail).toContain('copied to personal');
    expect(useNotices.getState().notice?.detail).toContain('EBUSY: file is open elsewhere');
  });

  it('says so when a steer reached no running turn', async () => {
    await mount(fakeBridge({ steerSession: vi.fn().mockResolvedValue({ steered: false }) }));
    consoleActions.steerSession('c1', 'actually, stop at the tests');
    await tick();
    expect(useNotices.getState().notice).toMatchObject({ title: 'Nothing to steer' });
  });

  it('stays quiet when the steer was taken', async () => {
    await mount();
    consoleActions.steerSession('c1', 'actually, stop at the tests');
    await tick();
    expect(useNotices.getState().notice).toBeUndefined();
  });
});

describe('a project swap leaves nothing of the old project behind', () => {
  it('drops the sessions, transcripts and per-session state it held — and keeps the settings', async () => {
    await mount();
    consoleActions.setSessionModel('c1', { model: 'opus', provider: 'claude' });
    consoleActions.onBannerAction('c1', 'cache', 'dismiss');
    consoleActions.setSettings({ theme: 'light' });
    await tick();
    expect(sessions().activeSessionId).toBe('c1');
    expect(transcriptOf('c1')?.status).toBe('ok');
    expect(ui().modelOverride['c1']).toBeDefined();

    resetProjectState();

    expect(sessions().list).toEqual({ status: 'loading' });
    expect(sessions().activeSessionId).toBeUndefined();
    expect(sessions().runStatus).toEqual({});
    expect(useTranscripts.getState().bySession).toEqual({});
    expect(data().agents).toEqual({ status: 'loading' });
    expect(ui().modelOverride).toEqual({});
    expect(ui().dismissedCache).toEqual({});
    // The user's own settings are not the project's — re-reading them would repaint the
    // whole window (a theme flash) for a fact that did not change.
    expect(ui().settings.theme).toBe('light');
  });

  it('keeps a run claim from surviving into the new project', async () => {
    const { emit, bridge } = pushable();
    await mount(bridge);
    emit({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    expect(sessions().runStatus['c1']).toBeDefined();
    resetProjectState();
    expect(sessions().runStatus).toEqual({});
  });

  it('survives the shell clearing the tab strip before the controller reboots', async () => {
    const { bridge } = await mount();
    useShell.getState().openTab('c1');
    const subscribes = (bridge.subscribeSession as ReturnType<typeof vi.fn>).mock.calls.length;

    // `applyProjectSwitch` empties the tabs in the same write that bumps the epoch, so the
    // OLD controller's tab subscription fires one last time — with nothing in it. Nothing
    // may be materialized off that, and nothing may throw before the reboot disposes it.
    useShell.getState().applyProjectSwitch({ name: 'other', root: '/other' });
    expect(useShell.getState().tabs).toEqual([]);
    expect((bridge.subscribeSession as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      subscribes,
    );

    resetProjectState();
    expect(useTranscripts.getState().bySession).toEqual({});
  });

  it("never lets the old controller's in-flight reads land in the project that replaced it", async () => {
    let answerList!: (value: typeof FAKE_SESSIONS) => void;
    let answerReload!: (value: ReturnType<typeof reloaded>) => void;
    const bridge = fakeBridge({
      listSessions: vi
        .fn()
        .mockReturnValue(new Promise<typeof FAKE_SESSIONS>((r) => (answerList = r))),
      reloadConversation: vi
        .fn()
        .mockReturnValue(new Promise<ReturnType<typeof reloaded>>((r) => (answerReload = r))),
    });
    const { controller } = await mount(bridge);
    // An open tab puts a transcript hydration in flight alongside the boot rail read —
    // the two reads that are genuinely out whenever someone swaps project mid-use.
    useShell.getState().openTab('old-1');
    await tick();

    // The swap itself: the old controller is torn down and the slices are cleared for the
    // project taking its place, while both reads are still unanswered.
    controller.dispose();
    resetProjectState();
    expect(sessions().list).toEqual({ status: 'loading' });
    expect(useTranscripts.getState().bySession).toEqual({});

    answerList([
      {
        id: 'old-1',
        agentRef: 'roles/reviewer',
        title: 'a thread of the old project',
        updatedAt: '2026-07-02T00:00:00Z',
      },
    ]);
    answerReload(reloaded());
    await tick();

    // Landing them would put the leaving project's rows back in the rail, make one of its
    // sessions the active conversation (which opens a foreign tab and persists it), and
    // re-materialize a transcript the new project's daemon does not hold.
    expect(sessions().activeSessionId).toBeUndefined();
    expect(sessions().list).toEqual({ status: 'loading' });
    expect(useTranscripts.getState().bySession).toEqual({});
  });

  it('forgets the tabs layout persistence restored from the project it left', async () => {
    // layout.json is per-user, not per-project, and the `tabs: []` of a swap never reaches
    // disk (the debounced save is cancelled by the same teardown) — so the reboot's
    // `bindLayoutPersistence` puts the LEAVING project's strip back before the new
    // controller has read a thing. This is that strip: two foreign ids and one real one.
    useShell.setState({ tabs: ['a1', 'c1', 'a2'], closedTabs: ['a3'] });
    const bridge = fakeBridge();
    await mount(bridge);

    expect(useShell.getState().tabs).toEqual(['c1']);
    expect(useShell.getState().closedTabs).toEqual([]);
    for (const id of ['a1', 'a2', 'a3']) {
      expect(bridge.subscribeSession).not.toHaveBeenCalledWith({ id });
      expect(bridge.reloadConversation).not.toHaveBeenCalledWith({ id });
      expect(bridge.sessionMode).not.toHaveBeenCalledWith({ id });
      expect(transcriptOf(id)).toBeUndefined();
    }
    // The real tab is materialized as always — pruning is not a licence to skip the work.
    expect(bridge.reloadConversation).toHaveBeenCalledWith({ id: 'c1' });
  });

  it('keeps a restored tab it cannot check — a session list that failed to load is not evidence', async () => {
    useShell.setState({ tabs: ['c1', 'c9'], closedTabs: [] });
    await mount(fakeBridge({ listSessions: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) }));
    expect(useShell.getState().tabs).toEqual(['c1', 'c9']);
  });

  it('drops the slow reads it had out too — the poll tick and the agent registry', async () => {
    let answerCap!: (value: { remaining: number; capHit: boolean }) => void;
    let answerAgents!: (value: unknown) => void;
    const bridge = fakeBridge({
      capState: vi
        .fn()
        .mockReturnValue(
          new Promise<{ remaining: number; capHit: boolean }>((r) => (answerCap = r)),
        ),
      listAgents: vi.fn().mockReturnValue(new Promise<unknown>((r) => (answerAgents = r))),
    });
    const { controller } = await mount(bridge);
    void controller.refresh();
    controller.dispose();
    resetProjectState();

    answerCap({ remaining: 9, capHit: false });
    answerAgents({ agents: MOCK_AGENTS, diagnostics: [] });
    await tick();

    expect(data().agents).toEqual({ status: 'loading' });
    expect(data().cap).toEqual({ status: 'loading' });
  });
});
