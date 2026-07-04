// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startConsole, type ConsoleBridge } from './console.js';
import { LAYOUT_EPOCH, makeDescriptor } from './panels/routing.js';

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
    listSessions: vi.fn().mockResolvedValue(FAKE_SESSIONS),
    newSession: vi.fn().mockResolvedValue({ id: 'c-new' }),
    reloadConversation: vi.fn().mockResolvedValue(FAKE_TURNS),
    deleteSession: vi.fn().mockResolvedValue({ ok: true }),
    recompilePrompt: vi.fn().mockResolvedValue({ recompiled: true }),
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
    // (row text is not assertable here — the Transcript is react-virtuoso, which
    // renders no rows under jsdom; the mapping is covered by pushToViewFrames' units).
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
      (b) => b.textContent?.trim() === 'Send',
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
    const option = [...dock().querySelectorAll('[role="option"]')].find((o) =>
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
    const option = [...dock.querySelectorAll('[role="option"]')].find((o) =>
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
      (b) => b.textContent?.trim() === 'Send',
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

  it('sends the agent selected role list to the daemon', async () => {
    // c1's agent (roles/reviewer, from MOCK_AGENTS) runs as the researcher role.
    const bridge = fakeBridge();
    const { container } = await mount(bridge);
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message the agent"]',
    );
    const send = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Send',
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

  it('ignores a persisted layout from a different arrangement epoch', async () => {
    const stale = { version: 1, root: { type: 'leaf', panelId: 'cost' } };
    const { container } = await mount(fakeBridge({ getLayout: vi.fn().mockResolvedValue(stale) }));
    expect(container.querySelector('[data-panel-id="conversation"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="nav"]')).not.toBeNull();
  });
});
