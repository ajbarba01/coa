// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState } from '../panels/fixtures.js';
import { MOCK_AGENTS } from '../panels/mockAgents.js';
import { buildRailItems, Center } from './Center.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

const SESSIONS = [
  {
    id: 'c1',
    title: 'wire the dock',
    agentRef: 'roles/dev',
    updatedAt: '2026-07-11T00:00:00.000Z',
  },
  { id: 'c2', title: 'fix the seam', agentRef: 'roles/dev', updatedAt: '2026-07-11T01:00:00.000Z' },
];

function publish(overrides: Parameters<typeof makeState>[0] = {}): ReturnType<typeof vi.fn> {
  const selectSession = vi.fn();
  publishConsoleState(
    makeState({
      data: { sessions: { status: 'ok', value: SESSIONS }, ...overrides.data },
      ui: { activeSessionId: 'c1', ...overrides.ui },
      actions: { selectSession, ...overrides.actions },
    }),
  );
  return selectSession;
}

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
  (window as unknown as { coa: unknown }).coa = { platform: 'win32' };
});

describe('Center tabs', () => {
  it('renders a tab per open session and routes a click through selectSession', () => {
    const selectSession = publish();
    useShell.getState().openTab('c1');
    useShell.getState().openTab('c2');
    render(<Center />);
    fireEvent.click(screen.getByRole('button', { name: /fix the seam/ }));
    expect(selectSession).toHaveBeenCalledWith('c2');
  });

  it('shows the raw indicator only while raw mode is on', () => {
    publish({ ui: { activeSessionId: 'c1', rawMode: true } });
    useShell.getState().openTab('c1');
    render(<Center />);
    expect(screen.getByText('raw')).toBeTruthy();
  });

  it('middle-click closes a tab and falls the active selection to the last remaining', () => {
    const selectSession = publish();
    useShell.getState().openTab('c1');
    useShell.getState().openTab('c2');
    render(<Center />);
    // c1 is active; middle-click its tab → working set drops it, selection falls to c2.
    fireEvent(
      screen.getByRole('button', { name: /wire the dock/ }),
      new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    );
    expect(useShell.getState().tabs).toEqual(['c2']);
    expect(selectSession).toHaveBeenCalledWith('c2');
  });
});

describe('Center tab-strip new-session menu', () => {
  it('the + control opens a menu of agents and selecting one calls newSession(ref)', async () => {
    const user = userEvent.setup();
    const newSession = vi.fn();
    publish({
      data: {
        agents: {
          status: 'ok',
          value: [
            { ref: 'roles/dev', name: 'dev', icon: 'bot', color: 'slate', scope: 'project' },
            { ref: 'roles/doc', name: 'docs', icon: 'bot', color: 'slate', scope: 'project' },
          ],
        },
      },
      actions: { newSession },
    });
    useShell.getState().openTab('c1');
    render(<Center />);
    await user.click(screen.getByRole('button', { name: 'new session' }));
    await user.click(screen.getByText('docs'));
    expect(newSession).toHaveBeenCalledExactlyOnceWith('roles/doc');
  });
});

describe('Center search morph', () => {
  it('swaps the strip and canvas into search mode and restores on cancel', () => {
    publish();
    useShell.getState().openTab('c1');
    render(<Center />);
    act(() => useShell.getState().openSearch());
    expect(screen.getByPlaceholderText('search sessions…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'cancel search' }));
    expect(useShell.getState().mode).toBe('work');
  });

  it('grows a tooltip naming the search shortcut on the ⌕ control', async () => {
    const user = userEvent.setup();
    publish();
    useShell.getState().openTab('c1');
    render(<Center />);
    const btn = screen.getByRole('button', { name: 'search sessions' });
    for (let i = 0; i < 25 && document.activeElement !== btn; i++) await user.tab();
    expect(document.activeElement).toBe(btn);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(/search sessions/);
    expect(tip).toHaveTextContent(/ctrl/);
  });

  it('keeps the chat canvas mounted (hidden) while searching, so exiting is instant', () => {
    publish();
    useShell.getState().openTab('c1');
    const { container } = render(<Center />);
    const before = container.querySelectorAll('[data-canvas="chat"]').length;
    expect(before).toBe(1);
    act(() => useShell.getState().openSearch());
    // still mounted — search overlays it, never unmounts it
    expect(container.querySelectorAll('[data-canvas="chat"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'cancel search' }));
    expect(container.querySelectorAll('[data-canvas="chat"]')).toHaveLength(1);
  });

  it('lets the search field shrink instead of colliding with the cancel control', () => {
    publish();
    useShell.getState().openTab('c1');
    render(<Center />);
    act(() => useShell.getState().openSearch());
    const field = screen.getByPlaceholderText('search sessions…').parentElement as HTMLElement;
    // A viewport-relative cap collides with the absolutely-placed ✕ on narrow
    // panels; the field must reserve the cancel zone and shrink from there.
    expect(field.className).toContain('min-w-0');
    expect(field.className).not.toContain('max-w-[70%]');
  });
});

describe('buildRailItems', () => {
  it('orders pinned agents first and marks them', () => {
    const items = buildRailItems(MOCK_AGENTS, ['personal/scratch-helper']);
    expect(items[0]).toMatchObject({ id: 'personal/scratch-helper', pinned: true });
    expect(items).toHaveLength(MOCK_AGENTS.length);
  });
});
