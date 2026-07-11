// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { modelSwitchNoteText, startConsole, type ConsoleBridge } from './console.js';
import type { AgentSummary } from '@coa/console-viewmodel';
import type { ConsoleState } from './panels/state.js';
import { MOCK_AGENTS } from './panels/mockAgents.js';
import { deserializeAgents, serializeAgents } from '../main/agentsStore.js';

/** A daemon-backed session + its persisted transcript (R-7), fed through the fake bridge. */
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
    listAgents: vi.fn().mockResolvedValue(MOCK_AGENTS),
    writeAgents: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue(FAKE_SESSIONS),
    newSession: vi.fn().mockResolvedValue({ id: 'c-new' }),
    reloadConversation: vi.fn().mockResolvedValue(FAKE_TURNS),
    deleteSession: vi.fn().mockResolvedValue({ ok: true }),
    recompilePrompt: vi.fn().mockResolvedValue({ recompiled: true }),
    interruptSession: vi.fn().mockResolvedValue({ interrupted: true }),
    steerSession: vi.fn().mockResolvedValue({ steered: true }),
    subscribeSession: vi.fn().mockResolvedValue({ subscribed: true }),
    openPath: vi.fn().mockResolvedValue({ ok: true, revealed: 'editor' }),
    openExternal: vi.fn().mockResolvedValue({ ok: true }),
    onPush: vi.fn().mockReturnValue(() => {}),
    getSettings: vi
      .fn()
      .mockResolvedValue({ theme: 'dark', density: 'compact', motion: 'full', pinnedAgents: [] }),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    ...over,
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

describe('startConsole (publishes ConsoleState through the injected sink)', () => {
  it('shows cap loading then live after refresh', async () => {
    const { last, controller } = await mount();
    expect(last().data.cap).toEqual({ status: 'loading' });
    await controller.refresh();
    expect(last().data.cap).toEqual({ status: 'ok', value: { remaining: 2.5, capHit: false } });
  });

  it('loads the reloaded (R-7) conversation transcript into state on mount', async () => {
    const { last } = await mount();
    expect(last().data.turns).toEqual({
      status: 'ok',
      value: [
        { id: 't0', role: 'you', kind: 'text', text: 'Refactor the auth module' },
        { id: 't1', role: 'agent', kind: 'text', text: 'on it' },
      ],
    });
  });

  // Known-weak pre-existing coverage (flagged, not redesigned here): a push for a
  // session that isn't the mounted one ('s' vs 'c1') is recorded but never merged
  // into visible state, so this only proves the handler doesn't throw.
  it('subscribes to the push stream and handles a live turn without throwing', async () => {
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
        sessionId: 's',
        worktree: 'w',
        seq: 0,
        frame: { t: 'text', text: 'hi' },
      }),
    ).not.toThrow();
    await flushRaf();
    expect(last().data.turns.status).toBe('ok');
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

  it('hydrates the run-status pill from the daemon on connect (G4 reattach), not from local send-tracking', async () => {
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
        { id: 's-active', agentRef: 'roles/reviewer', title: 'active', updatedAt: '2026-07-02T00:00:00Z' },
        { id: 's-bg', agentRef: 'roles/reviewer', title: 'background', updatedAt: '2026-07-01T00:00:00Z' },
      ]),
      reloadConversation: vi.fn().mockResolvedValue([]),
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
      kind: 'turn', sessionId: 'c1', worktree: 'w', seq: 1,
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

  it('steerSession proxies a barge-in to the bridge and does NOT render optimistically — the daemon pushes the framed steer live', async () => {
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
    // Barge-in reaches the daemon as the raw text…
    expect(bridge.steerSession).toHaveBeenCalledExactlyOnceWith({
      id: 'c1',
      text: 'go check the tests instead',
      mode: 'barge-in',
    });
    // …but is NOT rendered optimistically: the daemon is the single source of truth and pushes
    // the FRAMED steer live, so no local turn is appended (which would double it — raw typed
    // text live, framed text on reload — the reported duplication).
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

  it('creates an agent, persists it through the bridge, and rehydrates it on a simulated reload', async () => {
    // Shared on-disk `agents.json` blob standing in for ~/coa/agents.json across two
    // mounts (the second simulates a reload). Modeled through the REAL main-process store
    // serialization + a JSON hop, so the write and read shapes must actually agree — the
    // wipe-on-reload bug was a write-envelope / read-bare-array mismatch that a plain
    // in-memory array fake could never catch.
    const disk: { raw: unknown } = { raw: undefined };
    const readDisk = async (): Promise<AgentSummary[]> =>
      deserializeAgents(disk.raw === undefined ? undefined : JSON.parse(JSON.stringify(disk.raw)));
    const writeDisk = async (agents: AgentSummary[]): Promise<void> => {
      disk.raw = JSON.parse(JSON.stringify(serializeAgents(agents)));
    };

    // --- Bridge 1 (first launch): empty file, every mutation writes the new list ---
    const bridge1 = fakeBridge({
      listAgents: vi.fn().mockImplementation(readDisk),
      writeAgents: vi.fn().mockImplementation(writeDisk),
    });
    const { last: last1 } = await mount(bridge1);
    // Empty file => the "No agents yet" empty state's data (an empty ok list).
    expect(last1().data.agents).toEqual({ status: 'ok', value: [] });

    last1().actions.createAgent('personal');
    // The create mutates state now AND writes the new list through the bridge.
    expect(bridge1.writeAgents).toHaveBeenCalled();
    expect(last1().data.agents.status).toBe('ok');
    if (last1().data.agents.status === 'ok') {
      expect(last1().data.agents.value).toHaveLength(1);
      expect(last1().data.agents.value[0]?.ref).toBe('personal/untitled-agent');
    }

    // --- Bridge 2 (reload): seed from what bridge1 wrote; the agent must rehydrate ---
    const bridge2 = fakeBridge({
      listAgents: vi.fn().mockImplementation(readDisk),
    });
    const { last: last2 } = await mount(bridge2);
    expect(last2().data.agents.status).toBe('ok');
    if (last2().data.agents.status === 'ok') {
      // No longer the empty state: the persisted agent rehydrated.
      expect(last2().data.agents.value).toHaveLength(1);
      expect(last2().data.agents.value[0]?.ref).toBe('personal/untitled-agent');
    }
  });
});
