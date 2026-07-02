// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startConsole, type ConsoleBridge } from './console.js';
import { LAYOUT_EPOCH, makeDescriptor } from './panels/routing.js';

function fakeBridge(over: Partial<ConsoleBridge> = {}): ConsoleBridge {
  return {
    capState: vi.fn().mockResolvedValue({ remaining: 2.5, capHit: false }),
    flagsForUser: vi.fn().mockResolvedValue({ expanded: [], collapsed: [] }),
    listTimeline: vi.fn().mockResolvedValue([]),
    listAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
    currentAccount: vi.fn().mockResolvedValue({ active: 'ambient' }),
    useAccount: vi.fn().mockResolvedValue({ active: 'ambient' }),
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
  return { container, controller };
}

describe('startConsole (inspector-first)', () => {
  it('mounts the inspector layout: nav rail, cost main, chat+account dock', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-panel-id="nav"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="cost"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="conversation"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="account"]')).not.toBeNull();
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

  it('renders the mock chat transcript in the dock', async () => {
    const { container } = await mount();
    const dock = container.querySelector('[data-panel-id="conversation"]');
    expect(dock).not.toBeNull();
    // The transcript log only renders when the (seeded) mock stream has frames, so its
    // presence proves the mock flowed state -> selectVm -> Transcript.
    expect(dock?.querySelector('[role="log"]')).not.toBeNull();
  });

  it('seeds the chat with the newest mock session and the agent rail', async () => {
    const { container } = await mount();
    const dock = container.querySelector('[data-panel-id="conversation"]');
    // the session switcher shows the seeded session's title in the pane header
    expect(dock?.textContent).toContain('refactor auth module');
    // the agent drawer renders beside the transcript
    expect(dock?.querySelector('[role="group"][aria-label="Agents"]')).not.toBeNull();
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
