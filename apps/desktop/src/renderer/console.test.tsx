// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  detectAuthFailure,
  modelSwitchNoteText,
  onAuthFailure,
  startConsole,
  type ConsoleBridge,
} from './console.js';
import type { AgentFile, AgentSummary, TurnFrame } from '@coa/console-viewmodel';
import type { ConsoleState } from './panels/state.js';
import { MOCK_AGENTS } from './testing/mockAgents.js';

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
    listRoles: vi.fn().mockResolvedValue([]),
    listPackages: vi.fn().mockResolvedValue([]),
    listAgents: vi.fn().mockResolvedValue({ agents: MOCK_AGENTS, diagnostics: [] }),
    saveAgent: vi.fn().mockResolvedValue({ ok: true }),
    deleteAgent: vi.fn().mockResolvedValue({ removed: true }),
    listSessions: vi.fn().mockResolvedValue(FAKE_SESSIONS),
    newSession: vi.fn().mockResolvedValue({ id: 'c-new' }),
    reloadConversation: vi.fn().mockResolvedValue(reloaded()),
    deleteSession: vi.fn().mockResolvedValue({ ok: true }),
    recompilePrompt: vi.fn().mockResolvedValue({ recompiled: true }),
    interruptSession: vi.fn().mockResolvedValue({ interrupted: true }),
    steerSession: vi.fn().mockResolvedValue({ steered: true }),
    subscribeSession: vi.fn().mockResolvedValue({ subscribed: true }),
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

/** Wait one animation frame — the coalesced turn-flush (`flushTurns`) lands on the next
 *  `requestAnimationFrame`, so a test asserting on buffered turn content must wait for it
 *  (a subsequent `status` push flushes synchronously instead; see console.ts). */
function flushRaf(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** Mount the controller with a captured `publish` sink instead of the old engine
 *  container — `last()` reads the most recently published `ConsoleState`, which is
 *  what a real Workbench composition root would render from. */
async function mount(bridge = fakeBridge()) {
  const publish = vi.fn<(s: ConsoleState) => void>();
  const navigate = vi.fn<(surface: string) => void>();
  const controller = await startConsole(bridge, { publish, navigate });
  // Flush the fire-and-forget initial loads (accounts / models / sessions+transcript).
  await new Promise((r) => setTimeout(r, 0));
  const last = (): ConsoleState => {
    const call = publish.mock.calls.at(-1);
    if (!call) throw new Error('publish was never called');
    return call[0];
  };
  return { controller, publish, navigate, last };
}

describe('modelSwitchNoteText', () => {
  it('labels a known model with its effort', () => {
    const text = modelSwitchNoteText(
      { model: 'opus', reasoning: { mode: 'effort', effort: 'high' } },
      [{ id: 'opus', provider: 'claude', displayName: 'Opus', description: 'Opus 4.8 · smart' }],
    );
    expect(text).toBe('switched to Opus 4.8 · high');
  });

  it('falls back to the raw model id when the descriptor is unknown', () => {
    expect(modelSwitchNoteText({ model: 'mystery-model' }, [])).toBe('switched to mystery-model');
  });

  it('omits the effort segment when no reasoning is set (defensive)', () => {
    expect(
      modelSwitchNoteText({ model: 'opus' }, [
        { id: 'opus', provider: 'claude', displayName: 'Opus', description: 'Opus 4.8 · smart' },
      ]),
    ).toBe('switched to Opus 4.8');
  });

  it('omits the effort segment for an "off" reasoning mode', () => {
    expect(
      modelSwitchNoteText({ model: 'opus', reasoning: { mode: 'off' } }, [
        { id: 'opus', provider: 'claude', displayName: 'Opus', description: 'Opus 4.8 · smart' },
      ]),
    ).toBe('switched to Opus 4.8');
  });
});

describe('detectAuthFailure', () => {
  const err = (message: string): TurnFrame => ({
    id: 'e1',
    role: 'agent',
    kind: 'error',
    message,
  });

  it('spots auth-shaped error frames and ignores everything else', () => {
    expect(detectAuthFailure([err('401 Unauthorized')])).toBe(true);
    expect(detectAuthFailure([err('OAuth token revoked')])).toBe(true);
    expect(detectAuthFailure([err('Not logged in — run claude auth login')])).toBe(true);
    // A text frame that merely TALKS about auth is conversation, not a failure signal.
    expect(
      detectAuthFailure([{ id: 't', role: 'agent', kind: 'text', text: 'auth 401 login' }]),
    ).toBe(false);
    expect(detectAuthFailure([err('rate limit exceeded')])).toBe(false);
    expect(detectAuthFailure([])).toBe(false);
  });
});

describe('startConsole (publishes ConsoleState through the injected sink)', () => {
  it('shows cap loading then live after refresh', async () => {
    const { last, controller } = await mount();
    expect(last().data.cap).toEqual({ status: 'loading' });
    await controller.refresh();
    expect(last().data.cap).toEqual({ status: 'ok', value: { remaining: 2.5, capHit: false } });
  });

  it('publishes nothing when a poll returns unchanged data (the 2s App.tsx timer)', async () => {
    const { controller, publish } = await mount();
    await controller.refresh();
    const afterFirst = publish.mock.calls.length;
    await controller.refresh();
    expect(publish.mock.calls.length).toBe(afterFirst);
  });

  it('still publishes when a poll returns a changed value at the same status (cap.remaining ticks down)', async () => {
    const capState = vi.fn().mockResolvedValueOnce({ remaining: 2.5, capHit: false });
    const bridge = fakeBridge({ capState });
    const { controller, publish, last } = await mount(bridge);
    await controller.refresh();
    const afterFirst = publish.mock.calls.length;

    capState.mockResolvedValueOnce({ remaining: 2.1, capHit: false });
    await controller.refresh();

    expect(publish.mock.calls.length).toBe(afterFirst + 1);
    expect(last().data.cap).toEqual({ status: 'ok', value: { remaining: 2.1, capHit: false } });
  });

  it('still publishes when a polled timeline array gains an entry at the same status', async () => {
    const listTimeline = vi.fn().mockResolvedValueOnce([]);
    const bridge = fakeBridge({ listTimeline });
    const { controller, publish, last } = await mount(bridge);
    await controller.refresh();
    const afterFirst = publish.mock.calls.length;

    const entry = {
      id: 'chk1',
      seq: 0,
      ts: '2026-08-01T00:00:00Z',
      worktree: '/wt',
      pinned: false,
    };
    listTimeline.mockResolvedValueOnce([entry]);
    await controller.refresh();

    expect(publish.mock.calls.length).toBe(afterFirst + 1);
    expect(last().data.timeline).toEqual({ status: 'ok', value: [entry] });
  });

  it('loads the reloaded persisted conversation transcript into state on mount', async () => {
    const { last } = await mount();
    expect(last().data.turns).toEqual({
      status: 'ok',
      value: [
        { id: 't0', role: 'you', kind: 'text', text: 'Refactor the auth module' },
        { id: 't1', role: 'agent', kind: 'text', text: 'on it' },
      ],
    });
  });

  it('shows a transcript the daemon could not fully read as incomplete, not as the whole record', async () => {
    // The daemon's reload never throws — it hands back what it could read. Rendering that
    // remainder alone would present a fragment as the complete conversation, and nothing
    // else in the UI can hint otherwise, since missing turns leave no visible gap.
    const { last } = await mount(
      fakeBridge({ reloadConversation: vi.fn().mockResolvedValue(reloaded(FAKE_TURNS, 2)) }),
    );
    const turns = last().data.turns;
    expect(turns.status).toBe('ok');
    if (turns.status !== 'ok') return;
    expect(turns.value).toHaveLength(FAKE_TURNS.length + 1);
    expect(turns.value.at(-1)).toMatchObject({ role: 'system', kind: 'text' });
    expect(JSON.stringify(turns.value.at(-1))).toContain('2 unreadable events');
  });

  // Pushes under the mounted/active session ('c1', see FAKE_SESSIONS) so the frame
  // actually merges into visible state — asserts the pushed row renders, not just
  // that the handler doesn't throw.
  it('subscribes to the push stream and renders a live turn for the active session', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { last } = await mount(bridge);
    expect(emit).toBeDefined();

    expect(() =>
      emit?.({
        kind: 'turn',
        sessionId: 'c1',
        worktree: 'w',
        seq: 2,
        frame: { t: 'text', text: 'hi' },
      }),
    ).not.toThrow();
    await flushRaf();
    const turns = last().data.turns;
    expect(turns.status).toBe('ok');
    if (turns.status === 'ok') {
      expect(turns.value).toContainEqual(expect.objectContaining({ text: 'hi' }));
    }
  });

  it('an auth-shaped error push fires the registered auth-failure sink; others do not', async () => {
    const sink = vi.fn();
    onAuthFailure(sink);
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    await mount(bridge);

    emit?.({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 0,
      frame: { t: 'error', message: '401 Unauthorized', origin: 'loop' },
    });
    expect(sink).toHaveBeenCalledTimes(1);

    emit?.({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 1,
      frame: { t: 'error', message: 'rate limit exceeded', origin: 'loop' },
    });
    expect(sink).toHaveBeenCalledTimes(1); // non-auth errors never fire it

    // Reset the module-level sink so later tests never inherit this spy.
    onAuthFailure(() => {});
  });

  it('does not fire the sink for a session pinned to a non-claude provider; a default/claude session still does', async () => {
    const sink = vi.fn();
    onAuthFailure(sink);
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      listSessions: vi.fn().mockResolvedValue([
        ...FAKE_SESSIONS,
        {
          id: 'c2',
          agentRef: 'roles/reviewer',
          title: 'deepseek session',
          updatedAt: '2026-07-02T00:00:00Z',
          provider: 'deepseek',
        },
      ]),
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    await mount(bridge);

    // Pinned to deepseek — an auth-shaped error there has nothing to do with the claude
    // login and must not light that badge.
    emit?.({
      kind: 'turn',
      sessionId: 'c2',
      worktree: 'w',
      seq: 0,
      frame: { t: 'error', message: '401 Unauthorized', origin: 'loop' },
    });
    expect(sink).not.toHaveBeenCalled();

    // No provider recorded (the default backend is claude) — still fires.
    emit?.({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 1,
      frame: { t: 'error', message: '401 Unauthorized', origin: 'loop' },
    });
    expect(sink).toHaveBeenCalledTimes(1);

    onAuthFailure(() => {});
  });

  it('keeps the status pill running across a status running push and a following turn frame', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { last } = await mount(bridge);

    emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    expect(last().ui.runStatus['c1']).toBeDefined();

    // A following turn frame must not clear the pill — only a status push does.
    emit?.({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 0,
      frame: { t: 'text', text: 'hi' },
    });
    await flushRaf();
    expect(last().ui.runStatus['c1']).toBeDefined();
  });

  it('clears the status pill on a status done push', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { last } = await mount(bridge);

    emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    expect(last().ui.runStatus['c1']).toBeDefined();

    emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'done' });
    expect(last().ui.runStatus['c1']).toBeUndefined();
  });

  it('clears the status pill on a status error push', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { last } = await mount(bridge);

    emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    expect(last().ui.runStatus['c1']).toBeDefined();

    emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'error' });
    expect(last().ui.runStatus['c1']).toBeUndefined();
  });

  it('hydrates the run-status pill from the daemon on connect (reattach — the session exists independent of any viewer), not from local send-tracking', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { last } = await mount(bridge);

    // The active conversation ('c1', opened by the mount-time initSessions restore) must
    // have subscribed to the daemon's live session — the reattach that lets a fresh
    // controller (e.g. a reload mid-run) hydrate from the daemon's snapshot.
    expect(bridge.subscribeSession).toHaveBeenCalledWith({ id: 'c1' });

    // Simulate the daemon's subscribe-time hydration: a running status push arrives with
    // no local send/startSession issued in this instance.
    emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    expect(last().ui.runStatus['c1']).toBeDefined();
    expect(bridge.startSession).not.toHaveBeenCalled();
  });

  it('clears the status pill when the dispatch itself fails', async () => {
    const bridge = fakeBridge({
      startSession: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const { last } = await mount(bridge);

    last().actions.sendMessage('add tests');

    // The dispatch-failure catch clears the pill (a failed send never streams a status).
    // (The optimistic "running" set only reaches a publish via the rAF-coalesced turn
    // flush or this catch — there's no synchronous push to observe in between.)
    await new Promise((r) => setTimeout(r, 0));
    expect(last().ui.runStatus['c1']).toBeUndefined();
  });

  it('stages a deliberate model override and clears it once a send applies it (the cache-banner state)', async () => {
    const bridge = fakeBridge({
      listModels: vi.fn().mockResolvedValue([
        { id: 'deepseek-v4-pro', provider: 'deepseek' },
        { id: 'opus', provider: 'claude' },
      ]),
    });
    const { last } = await mount(bridge);

    expect(last().ui.modelOverride['c1']).toBeUndefined();
    last().actions.setSessionModel('c1', { model: 'deepseek-v4-pro', provider: 'deepseek' });
    expect(last().ui.modelOverride['c1']).toEqual({
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
    });

    last().actions.sendMessage('hi');
    expect(last().ui.modelOverride['c1']).toBeUndefined();
  });

  it('an in-chat model switch routes the next send to the picked backend', async () => {
    const bridge = fakeBridge({
      listModels: vi.fn().mockResolvedValue([
        { id: 'deepseek-v4-pro', provider: 'deepseek' },
        { id: 'opus', provider: 'claude' },
      ]),
    });
    const { last } = await mount(bridge);

    last().actions.setSessionModel('c1', { model: 'deepseek-v4-pro', provider: 'deepseek' });
    last().actions.sendMessage('hi');

    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: { model: 'deepseek-v4-pro', provider: 'deepseek' } }),
    );
  });

  it('merges a staged effort onto the staged model — a later effort pick never drops the model back to the agent default', async () => {
    // The exact reported bug: pick a backend, then pick a reasoning effort, and the
    // effort pick silently wiped the model out of the override so the send fell back
    // to the agent's default model. The two picks must accumulate.
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
    const { last } = await mount(bridge);

    last().actions.setSessionModel('c1', { model: 'deepseek-v4-pro', provider: 'deepseek' });
    last().actions.setSessionModel('c1', { reasoning: { mode: 'effort', effort: 'high' } });
    last().actions.sendMessage('hi');

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

  it('routes pushes by sessionId — background session output does not leak into the active one', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      // two sessions exist; 's-active' is opened/active, 's-bg' is running in the background
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
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { last } = await mount(bridge);
    expect(emit).toBeDefined();
    // The active session's reloaded transcript is genuinely empty (reloadConversation
    // resolves to []) — the empty state is real, not a rendering artifact. What this
    // test actually checks is that a push for a different session ('s-bg') does not
    // leak into it.
    expect(last().data.turns).toEqual({ status: 'ok', value: [] });

    // a turn for the NON-active session
    emit?.({
      kind: 'turn',
      sessionId: 's-bg',
      worktree: 'wt',
      seq: 1,
      frame: { t: 'text', text: 'background output' },
    });
    await flushRaf();
    // Must NOT have leaked into the active ('s-active') transcript.
    expect(last().data.turns).toEqual({ status: 'ok', value: [] });
    expect(last().ui.activeSessionId).toBe('s-active');
  });

  it('ignores a malformed push (validated at the edge, never throws)', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    await mount(bridge);
    expect(() => emit?.({ kind: 'not-a-real-kind' })).not.toThrow();
  });

  it('unsubscribes from the push stream on dispose', async () => {
    const unsubscribe = vi.fn();
    const bridge = fakeBridge({ onPush: vi.fn().mockReturnValue(unsubscribe) });
    const { controller } = await mount(bridge);
    controller.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('opens the newest session from the daemon and hydrates its state', async () => {
    const bridge = fakeBridge();
    const { last } = await mount(bridge);
    // the session list + the active session's transcript were loaded from the daemon
    expect(bridge.listSessions).toHaveBeenCalled();
    expect(bridge.reloadConversation).toHaveBeenCalledWith({ id: 'c1' });
    expect(last().ui.activeSessionId).toBe('c1');
    expect(last().data.sessions).toEqual({ status: 'ok', value: FAKE_SESSIONS });
  });

  it('switches sessions synchronously: the active id flips and loading shows before the reload lands', async () => {
    const TWO_SESSIONS = [
      ...FAKE_SESSIONS,
      { id: 'c2', agentRef: 'roles/reviewer', title: 'second', updatedAt: '2026-07-01T00:00:00Z' },
    ];
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
    const { last } = await mount(bridge);
    last().actions.selectSession('c2');
    // No await: the switch must not wait on the daemon round-trip.
    expect(last().ui.activeSessionId).toBe('c2');
    expect(last().data.turns).toEqual({ status: 'loading' });
    resolveReload(reloaded([{ seq: 0, frame: { t: 'text', text: 'second turn' } }]));
    await new Promise((r) => setTimeout(r, 0));
    expect(last().data.turns.status).toBe('ok');
  });

  it('re-opening a cached session serves its turns instantly, then reconciles in the background', async () => {
    const TWO_SESSIONS = [
      ...FAKE_SESSIONS,
      { id: 'c2', agentRef: 'roles/reviewer', title: 'second', updatedAt: '2026-07-01T00:00:00Z' },
    ];
    const bridge = fakeBridge({
      listSessions: vi.fn().mockResolvedValue(TWO_SESSIONS),
      reloadConversation: vi
        .fn()
        .mockResolvedValueOnce(reloaded()) // boot: c1
        .mockResolvedValueOnce(reloaded([{ seq: 0, frame: { t: 'text', text: 'second turn' } }])) // c2
        .mockImplementationOnce(() => new Promise(() => {})), // c1 again — held forever
    });
    const { last } = await mount(bridge);
    last().actions.selectSession('c2');
    await new Promise((r) => setTimeout(r, 0));
    last().actions.selectSession('c1');
    // c1 is warm — its cached turns render this same frame, no loading gap.
    expect(last().ui.activeSessionId).toBe('c1');
    const turns = last().data.turns;
    expect(turns.status).toBe('ok');
    if (turns.status === 'ok') expect(JSON.stringify(turns.value)).toContain('on it');
  });

  it('a stale reload landing after the user moved on never clobbers the active transcript', async () => {
    const TWO_SESSIONS = [
      ...FAKE_SESSIONS,
      { id: 'c2', agentRef: 'roles/reviewer', title: 'second', updatedAt: '2026-07-01T00:00:00Z' },
    ];
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
        ) // c2 — held
        .mockResolvedValueOnce(reloaded()), // c1 again
    });
    const { last } = await mount(bridge);
    last().actions.selectSession('c2');
    last().actions.selectSession('c1');
    await new Promise((r) => setTimeout(r, 0));
    resolveC2(reloaded([{ seq: 0, frame: { t: 'text', text: 'late c2 turn' } }]));
    await new Promise((r) => setTimeout(r, 0));
    expect(last().ui.activeSessionId).toBe('c1');
    const turns = last().data.turns;
    expect(turns.status).toBe('ok');
    if (turns.status === 'ok') expect(JSON.stringify(turns.value)).not.toContain('late c2 turn');
  });

  it('sends a composer message into the active session with its conversation id', async () => {
    const bridge = fakeBridge();
    const { last } = await mount(bridge);

    last().actions.sendMessage('add tests');

    // The active session is the daemon's newest (c1); the send carries its conversation id.
    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'add tests', conversationId: 'c1' }),
    );
  });

  it('settles an interrupted reasoning block and appends the interrupt marker from the daemon frames (live == reload)', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { last } = await mount(bridge);

    emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    // A reasoning block streams (open).
    emit?.({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 0,
      frame: { t: 'thinking-delta', text: 'weighing options' },
    });
    await flushRaf();
    const midTurns = last().data.turns;
    expect(midTurns.status).toBe('ok');
    if (midTurns.status === 'ok') {
      expect(midTurns.value).toContainEqual(
        expect.objectContaining({ kind: 'thinking', text: 'weighing options', streaming: true }),
      );
    }

    // A bare stop: the DAEMON settles the partial (with its measured duration) and records the
    // marker as real, persisted frames, then reports the terminal status. The console just
    // renders them — it never synthesizes closure of its own, which is what made live differ
    // from reload. The following status push flushes these turn frames synchronously.
    emit?.({
      kind: 'turn',
      sessionId: 'c1',
      worktree: 'w',
      seq: 1,
      frame: { t: 'thinking', text: 'weighing options', durationMs: 3000 },
    });
    emit?.({ kind: 'turn', sessionId: 'c1', worktree: 'w', seq: 2, frame: { t: 'interrupted' } });
    emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'interrupted' });

    const finalTurns = last().data.turns;
    expect(finalTurns.status).toBe('ok');
    if (finalTurns.status === 'ok') {
      const thinkingBlocks = finalTurns.value.filter((t) => t.kind === 'thinking');
      // The reasoning block settled from the daemon's frame — one block, not a duplicate.
      expect(thinkingBlocks).toHaveLength(1);
      expect(thinkingBlocks[0]).toMatchObject({ durationMs: 3000 });
      // …and the interrupt renders as its own marker frame (not a chat bubble, not an error).
      expect(finalTurns.value.some((t) => t.kind === 'interrupted')).toBe(true);
    }
  });

  it('interruptSession proxies the Stop affordance to the bridge for the active session', async () => {
    const bridge = fakeBridge();
    const { last } = await mount(bridge);
    last().actions.interruptSession('c1');
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
    const { last } = await mount(bridge);
    last().actions.steerSession('c1', 'use the JSON one');
    expect(calls).toEqual([{ id: 'c1', text: 'use the JSON one' }]);
  });

  it('steerSession proxies a steer to the bridge and does NOT render optimistically — the daemon writes the framed line on pickup', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { last } = await mount(bridge);
    const before = last().data.turns;

    last().actions.steerSession('c1', 'go check the tests instead');
    // The steer reaches the daemon as the raw text…
    expect(bridge.steerSession).toHaveBeenCalledExactlyOnceWith({
      id: 'c1',
      text: 'go check the tests instead',
    });
    // …but is NOT rendered optimistically: the daemon is the single source of truth and pushes
    // the FRAMED steer once the model actually receives it, so no local turn is appended here
    // (which would double it — raw typed text live, framed text on reload — the reported
    // duplication).
    expect(last().data.turns).toEqual(before);

    // The daemon pushes the framed steer as a live user turn → THAT is what lands, once.
    emit?.({
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
    const after = last().data.turns;
    expect(after.status).toBe('ok');
    if (after.status === 'ok') {
      expect(after.value).toContainEqual(
        expect.objectContaining({
          text: '[The user interrupted to steer you] go check the tests instead',
        }),
      );
    }
  });

  it('sends the agent selected role list to the daemon', async () => {
    // c1's agent (roles/reviewer, from MOCK_AGENTS) runs as the researcher role.
    const bridge = fakeBridge();
    const { last } = await mount(bridge);

    last().actions.sendMessage('audit the flow');

    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['researcher'] }),
    );
  });

  it('toggles raw mode', async () => {
    const { controller, last } = await mount();
    expect(last().ui.rawMode).toBe(false);
    controller.toggleRaw();
    expect(last().ui.rawMode).toBe(true);
  });

  it('surfaces the listAgents envelope’s load diagnostics into state — a broken agent file is reported, not silently absent', async () => {
    const diagnostic = {
      scope: 'personal' as const,
      ref: 'scratch',
      path: '/home/.coa/agents/scratch.yaml',
      problem: 'invalid' as const,
      detail: 'missing required field: description',
    };
    const bridge = fakeBridge({
      listAgents: vi.fn().mockResolvedValue({ agents: MOCK_AGENTS, diagnostics: [diagnostic] }),
    });
    const { last } = await mount(bridge);

    expect(last().data.agentDiagnostics).toEqual([diagnostic]);
  });

  it('creates an agent, persists it through saveAgent, and rehydrates it on a simulated reload', async () => {
    // A minimal stand-in for the daemon's per-agent-file registry: `saveAgent` writes one
    // entry, `listAgents` reads the whole map back. Shared across two bridges so the
    // second mount simulates what a reload actually sees (there is no whole-list write
    // anymore — each agent is its own file, written and read independently).
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

    // --- Bridge 1 (first launch): empty registry, create writes through to the daemon ---
    const bridge1 = fakeBridge({ listAgents: vi.fn().mockImplementation(readDisk), saveAgent });
    const { last: last1 } = await mount(bridge1);
    // Empty registry => the "No agents yet" empty state's data (an empty ok list).
    expect(last1().data.agents).toEqual({ status: 'ok', value: [] });

    last1().actions.createAgent('personal');
    // The ref is bare — no scope prefix — since it's the filename the daemon writes
    // (`~/.coa/agents/<ref>.yaml`); the scope is which directory it lands in, not part
    // of the ref itself.
    expect(saveAgent).toHaveBeenCalledWith({
      ref: 'untitled-agent',
      scope: 'personal',
      file: expect.objectContaining({ name: 'untitled-agent' }),
    });
    expect(last1().data.agents.status).toBe('ok');
    if (last1().data.agents.status === 'ok') {
      expect(last1().data.agents.value).toHaveLength(1);
      expect(last1().data.agents.value[0]?.ref).toBe('untitled-agent');
    }

    // --- Bridge 2 (reload): the shared registry carries what bridge1 wrote; rehydrates ---
    const bridge2 = fakeBridge({ listAgents: vi.fn().mockImplementation(readDisk) });
    const { last: last2 } = await mount(bridge2);
    expect(last2().data.agents.status).toBe('ok');
    if (last2().data.agents.status === 'ok') {
      // No longer the empty state: the saved agent rehydrated.
      expect(last2().data.agents.value).toHaveLength(1);
      expect(last2().data.agents.value[0]?.ref).toBe('untitled-agent');
    }
  });

  it('updateAgent writes the merged agent through saveAgent at its current scope', async () => {
    const saveAgent = vi.fn().mockResolvedValue({ ok: true });
    const bridge = fakeBridge({ saveAgent });
    const { last } = await mount(bridge);

    // c1's agent is MOCK_AGENTS' 'roles/reviewer' (scope: 'project').
    last().actions.updateAgent('roles/reviewer', { name: 'sec-reviewer' });

    expect(saveAgent).toHaveBeenCalledWith({
      ref: 'roles/reviewer',
      scope: 'project',
      file: expect.objectContaining({ name: 'sec-reviewer' }),
    });
    const agents = last().data.agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      expect(agents.value.find((a) => a.ref === 'roles/reviewer')?.name).toBe('sec-reviewer');
    }
  });

  it('updateAgent moving scope writes the new copy before removing the old one', async () => {
    const saveAgent = vi.fn().mockResolvedValue({ ok: true });
    const deleteAgent = vi.fn().mockResolvedValue({ removed: true });
    const bridge = fakeBridge({ saveAgent, deleteAgent });
    const { last } = await mount(bridge);

    last().actions.updateAgent('roles/reviewer', { scope: 'personal' });
    await new Promise((r) => setTimeout(r, 0));

    expect(saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'roles/reviewer', scope: 'personal' }),
    );
    expect(deleteAgent).toHaveBeenCalledWith({ ref: 'roles/reviewer', scope: 'project' });
    // Order is the whole safety property, not an implementation detail: the copy has to
    // exist before the original is removed.
    const saveOrder = saveAgent.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    const deleteOrder = deleteAgent.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    expect(saveOrder).toBeLessThan(deleteOrder);
  });

  it('updateAgent keeps the agent file when the second write of a scope move fails', async () => {
    // A scope move is two daemon writes and either can fail between them. Removing the
    // old copy first meant a failed second step erased the agent from BOTH scopes with
    // nothing left to recover it from — the one way this console could destroy a user
    // file. Writing first turns the same failure into a leftover copy.
    const disk = fakeAgentDisk(MOCK_AGENTS);
    let writes = 0;
    const failSecondWrite = <P,>(op: (p: P) => Promise<unknown>) =>
      vi.fn((p: P) => (++writes === 2 ? Promise.reject(new Error('EIO')) : op(p)));
    const bridge = fakeBridge({
      listAgents: vi.fn(disk.listAgents),
      saveAgent: failSecondWrite(disk.saveAgent),
      deleteAgent: failSecondWrite(disk.deleteAgent),
    });
    const { last } = await mount(bridge);
    expect(disk.scopesOf('roles/reviewer')).toEqual(['project']);

    last().actions.updateAgent('roles/reviewer', { scope: 'personal' });
    await new Promise((r) => setTimeout(r, 0));

    // The file survives the half-finished move — the agent is still on disk.
    expect(disk.scopesOf('roles/reviewer')).toContain('personal');
    expect(disk.scopesOf('roles/reviewer').length).toBeGreaterThan(0);
    const agents = last().data.agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      const rows = agents.value.filter((a) => a.ref === 'roles/reviewer');
      // Reconciled against disk: one row, and it reports the scope the daemon actually
      // resolves the agent from — so the move visibly did not take rather than the UI
      // claiming a move it only half made.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.scope).toBe('project');
    }
  });

  it('updateAgent rolls the edit back and re-reads the registry when the save fails', async () => {
    const bridge = fakeBridge({ saveAgent: vi.fn().mockRejectedValue(new Error('EACCES')) });
    const { last } = await mount(bridge);
    expect(bridge.listAgents).toHaveBeenCalledTimes(1);

    last().actions.updateAgent('roles/reviewer', { name: 'sec-reviewer' });
    await new Promise((r) => setTimeout(r, 0));

    const agents = last().data.agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      expect(agents.value.find((a) => a.ref === 'roles/reviewer')?.name).toBe('reviewer');
    }
    // Reconciled on SETTLE, not only on success.
    expect(bridge.listAgents).toHaveBeenCalledTimes(2);
  });

  it('createAgent takes the optimistic row back down when the save fails', async () => {
    const bridge = fakeBridge({ saveAgent: vi.fn().mockRejectedValue(new Error('ENOSPC')) });
    const { last } = await mount(bridge);
    const selectedBefore = last().ui.selectedAgentRef;

    last().actions.createAgent('personal');
    await new Promise((r) => setTimeout(r, 0));

    const agents = last().data.agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      expect(agents.value.some((a) => a.ref === 'untitled-agent')).toBe(false);
    }
    expect(last().ui.selectedAgentRef).toBe(selectedBefore);
    expect(bridge.listAgents).toHaveBeenCalledTimes(2);
  });

  it('deleteAgent puts the row and the selection back when the delete fails', async () => {
    const bridge = fakeBridge({ deleteAgent: vi.fn().mockRejectedValue(new Error('EBUSY')) });
    const { last } = await mount(bridge);
    last().actions.selectAgent('personal/scratch-helper');

    last().actions.deleteAgent('personal/scratch-helper');
    await new Promise((r) => setTimeout(r, 0));

    const agents = last().data.agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      expect(agents.value.some((a) => a.ref === 'personal/scratch-helper')).toBe(true);
    }
    expect(last().ui.selectedAgentRef).toBe('personal/scratch-helper');
    expect(bridge.listAgents).toHaveBeenCalledTimes(2);
  });

  it('updateAgent refuses a builtin agent — it never reaches the bridge', async () => {
    const saveAgent = vi.fn();
    const bridge = fakeBridge({
      listAgents: vi.fn().mockResolvedValue({
        agents: [
          { ref: 'general-purpose', name: 'General purpose', description: 'd', scope: 'builtin' },
        ],
        diagnostics: [],
      }),
      saveAgent,
    });
    const { last } = await mount(bridge);

    last().actions.updateAgent('general-purpose', { name: 'renamed' });

    expect(saveAgent).not.toHaveBeenCalled();
    const agents = last().data.agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') expect(agents.value[0]?.name).toBe('General purpose');
  });

  it('deleteAgent proxies the agent’s own scope to the daemon delete', async () => {
    const deleteAgent = vi.fn().mockResolvedValue({ removed: true });
    const bridge = fakeBridge({ deleteAgent });
    const { last } = await mount(bridge);

    // MOCK_AGENTS' 'personal/scratch-helper' (scope: 'personal').
    last().actions.deleteAgent('personal/scratch-helper');

    expect(deleteAgent).toHaveBeenCalledWith({ ref: 'personal/scratch-helper', scope: 'personal' });
    const agents = last().data.agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') {
      expect(agents.value.some((a) => a.ref === 'personal/scratch-helper')).toBe(false);
    }
  });

  it('deleteAgent refuses a builtin agent — it never reaches the bridge', async () => {
    const deleteAgent = vi.fn();
    const bridge = fakeBridge({
      listAgents: vi.fn().mockResolvedValue({
        agents: [
          { ref: 'general-purpose', name: 'General purpose', description: 'd', scope: 'builtin' },
        ],
        diagnostics: [],
      }),
      deleteAgent,
    });
    const { last } = await mount(bridge);

    last().actions.deleteAgent('general-purpose');

    expect(deleteAgent).not.toHaveBeenCalled();
    const agents = last().data.agents;
    expect(agents.status).toBe('ok');
    if (agents.status === 'ok') expect(agents.value).toHaveLength(1);
  });

  it('hydrate() recovers reads that failed at cold boot (daemon not up yet when startConsole fired them)', async () => {
    // Cold boot with autostart: the daemon isn't listening yet, so every boot read fails
    // into an error Remote on mount. Nothing else retries them — `hydrate()` (fired from
    // App.tsx's `cameUp` handler once the daemon actually comes up) is the only recovery.
    const bridge = fakeBridge({
      listAccounts: vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue({ accounts: [{ label: 'acct', provider: 'claude' }], active: {} }),
      listSessions: vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue(FAKE_SESSIONS),
      // listAgents is a daemon proxy too — it must recover through hydrate() the same way
      // accounts/sessions do, not stay stuck at the empty floor for the whole session.
      listAgents: vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue({ agents: MOCK_AGENTS, diagnostics: [] }),
    });
    const { last, controller } = await mount(bridge);

    expect(last().data.accounts.status).toBe('error');
    expect(last().data.sessions.status).toBe('error');
    // listAgents' rejection degrades to the empty floor (never a mock, never an error status —
    // see initAgents' doc comment), so the only observable symptom pre-hydrate is an empty list.
    expect(last().data.agents).toEqual({ status: 'ok', value: [] });
    expect(last().ui.activeSessionId).toBeUndefined();

    await controller.hydrate();

    expect(last().data.accounts).toEqual({
      status: 'ok',
      value: { accounts: [{ label: 'acct', provider: 'claude' }], active: {} },
    });
    expect(last().data.sessions).toEqual({ status: 'ok', value: FAKE_SESSIONS });
    expect(last().data.agents).toEqual({ status: 'ok', value: MOCK_AGENTS });
    // Sessions recovered from error ⇒ initSessions re-ran and opened the newest session.
    expect(last().ui.activeSessionId).toBe('c1');
  });

  it('hydrate() fired immediately after startup dedupes against the in-flight boot loads (ordinary launch race)', async () => {
    // On an ordinary launch (daemon already up) the daemon-status handler fires `cameUp`
    // at startup too, so hydrate() can arrive BEFORE the boot-time initSessions settles.
    // It must await the tracked boot loads and then see ok+active — not read the guard
    // mid-boot and start a second, concurrent initSessions (double IPC on every launch).
    const bridge = fakeBridge();
    const publish = vi.fn<(s: ConsoleState) => void>();
    const controller = await startConsole(bridge, { publish, navigate: vi.fn() });

    // No boot-flush wait: hydrate races the fire-and-forget boot loads deliberately.
    await controller.hydrate();
    await new Promise((r) => setTimeout(r, 0));

    expect(bridge.listSessions).toHaveBeenCalledTimes(1);
    expect(bridge.reloadConversation).toHaveBeenCalledTimes(1);
  });

  it('hydrate() does not re-run initSessions when reads are already ok and a session is active (a mid-use daemon restart)', async () => {
    // A daemon RESTART also fires `cameUp` while the console is mid-use with a perfectly
    // healthy active session. Re-running initSessions unconditionally would yank the user
    // to whatever session is newest — hydrate() must skip it when nothing is broken.
    const bridge = fakeBridge();
    const { last, controller } = await mount(bridge);
    expect(last().ui.activeSessionId).toBe('c1');

    vi.mocked(bridge.listSessions).mockClear();
    vi.mocked(bridge.reloadConversation).mockClear();

    await controller.hydrate();

    expect(bridge.listSessions).not.toHaveBeenCalled();
    expect(bridge.reloadConversation).not.toHaveBeenCalled();
    expect(last().ui.activeSessionId).toBe('c1');
  });
});
