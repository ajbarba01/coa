// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { modelSwitchNoteText, startConsole, type ConsoleBridge } from './console.js';
import type { AgentSummary } from '@coa/console-viewmodel';
import { LAYOUT_EPOCH, makeDescriptor } from './panels/routing.js';
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
    getLayout: vi.fn().mockResolvedValue(undefined),
    saveLayout: vi.fn().mockResolvedValue(undefined),
    getSettings: vi
      .fn()
      .mockResolvedValue({ theme: 'dark', density: 'compact', motion: 'full', pinnedAgents: [] }),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

// Mark this as a React act environment so userEvent's internal act() calls (used to
// drive the Radix effort Select) don't warn about an unconfigured environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Radix Select (the effort control) drives a portal-rendered listbox via pointer
// capture + scrollIntoView — neither implemented in jsdom. Stub them so the effort
// dropdown can be opened and picked in tests.
beforeAll(() => {
  const proto = window.HTMLElement.prototype;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

afterEach(() => {
  document.body.innerHTML = '';
});

async function mount(bridge = fakeBridge()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let controller!: Awaited<ReturnType<typeof startConsole>>;
  await act(async () => {
    controller = await startConsole(container, bridge);
  });
  // Flush the fire-and-forget initial loads (accounts / models / sessions+transcript).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { container, controller };
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

describe('startConsole (inspector-first)', () => {
  it('mounts the inspector layout: nav rail, cost main, chat dock', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-panel-id="nav"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="cost"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="conversation"]')).not.toBeNull();
    // account + agent config are nav-routed main surfaces now, not dock panes
    expect(container.querySelector('[data-panel-id="account"]')).toBeNull();
    expect(container.querySelector('[data-panel-id="agent"]')).toBeNull();
  });

  it('shows cost loading then live after refresh', async () => {
    const { container, controller } = await mount();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    await act(async () => {
      await controller.refresh();
    });
    expect(container.textContent).toContain('$2.50 left');
  });

  it('renders the reloaded conversation transcript in the dock', async () => {
    const { container } = await mount();
    const dock = container.querySelector('[data-panel-id="conversation"]');
    expect(dock).not.toBeNull();
    // The transcript log only renders when the reloaded (R-7) stream has frames, so its
    // presence proves reloadConversation flowed state -> selectVm -> Transcript.
    expect(dock?.querySelector('[role="log"]')).not.toBeNull();
  });

  it('subscribes to the push stream and handles a live turn without throwing', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { container } = await mount(bridge);
    expect(emit).toBeDefined();

    // A valid turn push flows through pushToViewFrames into the active conversation
    // (row text is not asserted here — this push's sessionId ('s') never matches the
    // mounted session ('c1'), so it is recorded but not merged into visible state; the
    // mapping itself is covered by pushToViewFrames' units).
    await act(async () => {
      emit?.({
        kind: 'turn',
        sessionId: 's',
        worktree: 'w',
        seq: 0,
        frame: { t: 'text', text: 'hi' },
      });
    });
    expect(container.querySelector('[data-panel-id="conversation"] [role="log"]')).not.toBeNull();
  });

  it('keeps the status pill running across a status running push and a following turn frame', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { container } = await mount(bridge);
    const dock = () => container.querySelector('[data-panel-id="conversation"]') as HTMLElement;

    await act(async () => {
      emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    });
    expect(dock().textContent).toContain('running for');

    // A following turn frame must not clear the pill — only a status push does.
    await act(async () => {
      emit?.({
        kind: 'turn',
        sessionId: 'c1',
        worktree: 'w',
        seq: 0,
        frame: { t: 'text', text: 'hi' },
      });
    });
    expect(dock().textContent).toContain('running for');
  });

  it('clears the status pill on a status done push', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { container } = await mount(bridge);
    const dock = () => container.querySelector('[data-panel-id="conversation"]') as HTMLElement;

    await act(async () => {
      emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    });
    expect(dock().textContent).toContain('running for');

    await act(async () => {
      emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'done' });
    });
    expect(dock().textContent).toContain('idle');
  });

  it('clears the status pill on a status error push', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { container } = await mount(bridge);
    const dock = () => container.querySelector('[data-panel-id="conversation"]') as HTMLElement;

    await act(async () => {
      emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    });
    expect(dock().textContent).toContain('running for');

    await act(async () => {
      emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'error' });
    });
    expect(dock().textContent).toContain('idle');
  });

  it('hydrates the run-status pill from the daemon on connect (G4 reattach), not from local send-tracking', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { container } = await mount(bridge);
    const dock = () => container.querySelector('[data-panel-id="conversation"]') as HTMLElement;

    // The active conversation ('c1', opened by the mount-time initSessions restore) must
    // have subscribed to the daemon's live session — the reattach that lets a fresh
    // renderer (e.g. a reload mid-run) hydrate from the daemon's snapshot.
    expect(bridge.subscribeSession).toHaveBeenCalledWith({ id: 'c1' });

    // Simulate the daemon's subscribe-time hydration: a running status push arrives with
    // no local send/startSession issued in this renderer instance.
    await act(async () => {
      emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    });
    expect(dock().textContent).toContain('running for');
    expect(bridge.startSession).not.toHaveBeenCalled();
  });

  it('clears the status pill when the dispatch itself fails', async () => {
    const bridge = fakeBridge({
      startSession: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const { container } = await mount(bridge);
    const dock = () => container.querySelector('[data-panel-id="conversation"]') as HTMLElement;

    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message the agent"]',
    );
    const send = [...container.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Send',
    );
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(textarea, 'add tests');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      send!.click();
    });
    // The dispatch-failure catch clears the pill (a failed send never streams a status).
    expect(dock().textContent).toContain('idle');
  });

  it('shows a predictive cache banner the moment a model is staged, and clears it on send', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const bridge = fakeBridge({
      // A fresh updatedAt each call so the (unrelated) idle-staleness path never triggers.
      listSessions: vi.fn(async () => [
        { id: 'c1', agentRef: 'roles/reviewer', title: 't', updatedAt: new Date().toISOString(), provider: 'claude', model: 'opus' },
      ]),
      listModels: vi.fn().mockResolvedValue([
        { id: 'deepseek-v4-pro', provider: 'deepseek' },
        { id: 'opus', provider: 'claude' },
      ]),
    });
    const { container } = await mount(bridge);
    const dock = () => container.querySelector('[data-panel-id="conversation"]') as HTMLElement;

    // No banner before any change.
    expect(dock().textContent).not.toContain('cold prompt cache');

    // Stage a DeepSeek pick → the cache banner appears immediately (before any send).
    const combo = dock().querySelector('[role="combobox"]') as HTMLElement;
    await act(async () => {
      fireEvent.focus(combo);
    });
    // The dropdown renders through a portal to document.body, so query the document.
    const option = [...document.querySelectorAll('[role="option"]')].find((o) =>
      o.textContent?.includes('deepseek-v4-pro'),
    ) as HTMLElement;
    await act(async () => {
      fireEvent.mouseDown(option);
    });
    expect(dock().textContent).toContain('cold prompt cache');

    // Sending applies the pick → the informational banner clears.
    const input = container.querySelector('[aria-label="Message the agent"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'hi' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(dock().textContent).not.toContain('cold prompt cache');
  });

  it('an in-chat model switch routes the next send to the picked backend', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const bridge = fakeBridge({
      listModels: vi.fn().mockResolvedValue([
        { id: 'deepseek-v4-pro', provider: 'deepseek' },
        { id: 'opus', provider: 'claude' },
      ]),
    });
    const { container } = await mount(bridge);

    // Pick DeepSeek in the in-chat model bar (the conversation panel's combobox).
    const dock = container.querySelector('[data-panel-id="conversation"]') as HTMLElement;
    const combo = dock.querySelector('[role="combobox"]') as HTMLElement;
    expect(combo).not.toBeNull();
    await act(async () => {
      fireEvent.focus(combo);
    });
    // The dropdown renders through a portal to document.body, so query the document.
    const option = [...document.querySelectorAll('[role="option"]')].find((o) =>
      o.textContent?.includes('deepseek-v4-pro'),
    ) as HTMLElement;
    expect(option).toBeDefined();
    await act(async () => {
      fireEvent.mouseDown(option);
    });

    // Send a message — it must route to the picked backend as a coherent unit.
    const input = container.querySelector('[aria-label="Message the agent"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'hi' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: { model: 'deepseek-v4-pro', provider: 'deepseek' } }),
    );
  });

  it('merges a staged effort onto the staged model — a later effort pick never drops the model back to the agent default', async () => {
    // The exact reported bug: pick a backend in the composer, then pick a reasoning
    // effort, and the effort pick silently wiped the model out of the override so the
    // send fell back to the agent's default model. The two picks must accumulate.
    const { fireEvent, screen } = await import('@testing-library/react');
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
    const { container } = await mount(bridge);
    const dock = container.querySelector('[data-panel-id="conversation"]') as HTMLElement;

    // 1) Stage the DeepSeek model via the model combobox (portal-rendered options).
    const modelCombo = dock.querySelector('[role="combobox"]') as HTMLElement;
    await act(async () => {
      fireEvent.focus(modelCombo);
    });
    const modelOption = [...document.querySelectorAll('[role="option"]')].find((o) =>
      o.textContent?.includes('deepseek-v4-pro'),
    ) as HTMLElement;
    await act(async () => {
      fireEvent.mouseDown(modelOption);
    });

    // 2) Now the effort control is available (DeepSeek supports effort) — stage "high"
    // through the Radix Select. Open it with the keyboard and click the option: a
    // pointer *move* (userEvent's default) trips react-resizable-panels' global
    // pointermove handler in jsdom, so keep to keydown + click (no move).
    const effortTrigger = screen.getByRole('combobox', { name: 'Effort' });
    await act(async () => {
      effortTrigger.focus();
      fireEvent.keyDown(effortTrigger, { key: 'Enter' });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'high' }));
    });

    // 3) Send — the request must carry the merged selection, not just the effort.
    const input = container.querySelector('[aria-label="Message the agent"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'hi' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
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
    const { container } = await mount(bridge);
    expect(emit).toBeDefined();
    const dock = () => container.querySelector('[data-panel-id="conversation"]') as HTMLElement;
    // The active session's reloaded transcript is genuinely empty (reloadConversation
    // resolves to []) — the empty state is real, not a rendering artifact. What this
    // test actually checks is that a push for a different session ('s-bg') does not
    // leak into it: the empty state must persist and no [role="log"] must appear.
    expect(dock().textContent).toContain('No conversation yet');

    // a turn for the NON-active session
    await act(async () => {
      emit?.({
        kind: 'turn',
        sessionId: 's-bg',
        worktree: 'wt',
        seq: 1,
        frame: { t: 'text', text: 'background output' },
      });
    });
    // Must NOT have leaked into the active ('s-active') transcript.
    expect(dock().textContent).toContain('No conversation yet');
    expect(dock().querySelector('[role="log"]')).toBeNull();
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
    act(() => controller.dispose());
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('opens the newest session from the daemon and renders the agent rail', async () => {
    const bridge = fakeBridge();
    const { container } = await mount(bridge);
    const dock = container.querySelector('[data-panel-id="conversation"]');
    // the session list + the active session's transcript were loaded from the daemon
    expect(bridge.listSessions).toHaveBeenCalled();
    expect(bridge.reloadConversation).toHaveBeenCalledWith({ id: 'c1' });
    // the session switcher shows the loaded session's title in the pane header
    expect(dock?.textContent).toContain('refactor auth module');
    // the agent drawer renders beside the transcript
    expect(dock?.querySelector('[role="group"][aria-label="Agents"]')).not.toBeNull();
  });

  it('sends a composer message into the active session with its conversation id', async () => {
    const bridge = fakeBridge();
    const { container } = await mount(bridge);
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message the agent"]',
    );
    const send = [...container.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Send',
    );
    expect(textarea).not.toBeNull();
    expect(send).toBeDefined();
    // React tracks the value internally, so set it via the native setter + input event.
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(textarea, 'add tests');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      send!.click();
    });
    // The active session is the daemon's newest (c1); the send carries its conversation id.
    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'add tests', conversationId: 'c1' }),
    );
  });

  it('settles an interrupted reasoning block and shows the interrupt marker from the daemon frames (live == reload)', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { container } = await mount(bridge);
    const dock = () => container.querySelector('[data-panel-id="conversation"]') as HTMLElement;

    await act(async () => {
      emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'running' });
    });
    // A reasoning block streams (open, shimmering).
    await act(async () => {
      emit?.({ kind: 'turn', sessionId: 'c1', worktree: 'w', seq: 0, frame: { t: 'thinking-delta', text: 'weighing options' } });
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    expect(dock().textContent).toContain('Thinking');

    // A bare stop: the DAEMON settles the partial (with its measured duration) and records the
    // marker as real frames, then reports the terminal status. The console just renders them —
    // it never synthesizes closure of its own, which is what made live differ from reload.
    await act(async () => {
      emit?.({
        kind: 'turn', sessionId: 'c1', worktree: 'w', seq: 1,
        frame: { t: 'thinking', text: 'weighing options', durationMs: 3000 },
      });
      emit?.({ kind: 'turn', sessionId: 'c1', worktree: 'w', seq: 2, frame: { t: 'interrupted' } });
      emit?.({ kind: 'status', sessionId: 'c1', worktree: 'w', state: 'interrupted' });
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    // The reasoning block settled from the daemon's frame — one block, not a duplicate.
    expect(dock().textContent).toContain('Thought for 3s');
    // …and the interrupt renders as the quiet system line (not a chat bubble, not an error).
    expect(dock().textContent).toContain('Request interrupted by user');
  });

  it('a bare Stop while a turn is running proxies interruptSession for the active session', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { container } = await mount(bridge);
    await act(async () => {
      emit?.({ kind: 'status', sessionId: 'c1', worktree: '/wt', state: 'running' });
    });
    // While running the composer shows Queue + Steer + a dedicated always-on Stop.
    const stop = [...container.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Stop',
    );
    expect(stop).toBeDefined();
    await act(async () => {
      stop!.click();
    });
    expect(bridge.interruptSession).toHaveBeenCalledExactlyOnceWith({ id: 'c1' });
  });

  it('a barge-in (typed message + Steer) proxies steerSession and does NOT render optimistically — the daemon pushes the framed steer live', async () => {
    let emit: ((payload: unknown) => void) | undefined;
    const bridge = fakeBridge({
      onPush: vi.fn((listener: (payload: unknown) => void) => {
        emit = listener;
        return () => {};
      }),
    });
    const { container } = await mount(bridge);
    await act(async () => {
      emit?.({ kind: 'status', sessionId: 'c1', worktree: '/wt', state: 'running' });
    });
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message the agent"]',
    );
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(textarea, 'go check the tests instead');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const steer = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Steer');
    await act(async () => {
      steer!.click();
    });
    // Barge-in reaches the daemon as the raw text…
    expect(bridge.steerSession).toHaveBeenCalledExactlyOnceWith({
      id: 'c1',
      text: 'go check the tests instead',
      mode: 'barge-in',
    });
    // …but is NOT rendered optimistically: the daemon is the single source of truth and pushes
    // the FRAMED steer live, so the console must not also show the raw typed text (which would
    // double-render — raw live, framed on reload — the reported duplication).
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    expect(container.textContent).not.toContain('go check the tests instead');

    // The daemon pushes the framed steer as a live user turn → THAT is what renders, once.
    await act(async () => {
      emit?.({
        kind: 'turn',
        sessionId: 'c1',
        worktree: '/wt',
        seq: 7,
        frame: { t: 'text', text: '[The user interrupted to steer you] go check the tests instead', role: 'user' },
      });
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    expect(container.textContent).toContain('[The user interrupted to steer you] go check the tests instead');
  });

  it('sends the agent selected role list to the daemon', async () => {
    // c1's agent (roles/reviewer, from MOCK_AGENTS) runs as the researcher role.
    const bridge = fakeBridge();
    const { container } = await mount(bridge);
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message the agent"]',
    );
    const send = [...container.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Send',
    );
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(textarea, 'audit the flow');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      send!.click();
    });
    expect(bridge.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['researcher'] }),
    );
  });

  it('toggles the conversation into raw mode', async () => {
    const { container, controller } = await mount();
    const rawButton = (): Element | null =>
      container.querySelector('[data-panel-id="conversation"] [aria-pressed]');
    expect(rawButton()?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      controller.toggleRaw();
    });
    expect(rawButton()?.getAttribute('aria-pressed')).toBe('true');
    // the pane region is renamed for assistive tech too
    expect(
      container.querySelector('[data-panel-id="conversation"] [aria-label="Chat · raw"]'),
    ).not.toBeNull();
  });

  it('syncs the nav selection to the restored main panel (not the hard default)', async () => {
    const persisted = { epoch: LAYOUT_EPOCH, descriptor: makeDescriptor('flags') };
    const { container } = await mount(
      fakeBridge({ getLayout: vi.fn().mockResolvedValue(persisted) }),
    );
    // The restored layout shows Flags in the main region…
    expect(container.querySelector('[data-panel-id="flags"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="cost"]')).toBeNull();
    // …and the nav rail marks Flags active, not the DEFAULT_MAIN_PANEL_ID (Cost).
    const active = container.querySelector('nav [aria-current="page"]');
    expect(active?.getAttribute('aria-label')).toBe('Flags');
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
    const c1 = document.createElement('div');
    document.body.appendChild(c1);
    await act(async () => {
      await startConsole(c1, bridge1);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // The nav rail's "Agents" route opens the full panel; click it to reveal the editor.
    const navToAgents = [...c1.querySelectorAll('nav a, nav button')].find((el) =>
      (el.getAttribute('aria-label') ?? el.textContent)?.trim().startsWith('Agents'),
    ) as HTMLElement | undefined;
    expect(navToAgents).toBeDefined();
    await act(async () => {
      navToAgents!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // Empty file => the "No agents yet" empty state, with a creator button.
    expect(c1.textContent).toContain('No agents yet');
    const newButton = [...c1.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'New agent',
    ) as HTMLElement | undefined;
    expect(newButton).toBeDefined();
    await act(async () => {
      newButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // The create mutates state now AND writes the new list through the bridge.
    expect(bridge1.writeAgents).toHaveBeenCalled();

    // --- Bridge 2 (reload): seed from what bridge1 wrote; the agent must rehydrate ---
    const bridge2 = fakeBridge({
      listAgents: vi.fn().mockImplementation(readDisk),
    });
    const c2 = document.createElement('div');
    document.body.appendChild(c2);
    await act(async () => {
      await startConsole(c2, bridge2);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const navToAgents2 = [...c2.querySelectorAll('nav a, nav button')].find((el) =>
      (el.getAttribute('aria-label') ?? el.textContent)?.trim().startsWith('Agents'),
    ) as HTMLElement | undefined;
    expect(navToAgents2).toBeDefined();
    await act(async () => {
      navToAgents2!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // No longer the empty state: the persisted agent's picker ("Switch agent") shows.
    expect(c2.querySelector('[aria-label="Switch agent"]')).not.toBeNull();
    expect(c2.textContent).not.toContain('No agents yet');
  });

  it('ignores a persisted layout from a different arrangement epoch', async () => {
    const stale = { version: 1, root: { type: 'leaf', panelId: 'cost' } };
    const { container } = await mount(fakeBridge({ getLayout: vi.fn().mockResolvedValue(stale) }));
    expect(container.querySelector('[data-panel-id="conversation"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="nav"]')).not.toBeNull();
  });
});
