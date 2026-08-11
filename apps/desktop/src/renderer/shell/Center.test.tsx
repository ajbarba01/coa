// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveSession } from '../store/sessions.js';
import { resetStores, seedStores } from '../testing/fixtures.js';
import { MOCK_AGENTS } from '../testing/mockAgents.js';
import { buildRailItems, Center } from './Center.js';
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

function publish(overrides: Parameters<typeof seedStores>[0] = {}): ReturnType<typeof vi.fn> {
  const selectSession = vi.fn();
  seedStores({
    data: { sessions: { status: 'ok', value: SESSIONS }, ...overrides.data },
    ui: { activeSessionId: 'c1', ...overrides.ui },
    actions: { selectSession, ...overrides.actions },
  });
  return selectSession;
}

beforeEach(() => {
  useShell.setState(initialShell, true);
  resetStores();
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

  it('keeps restored tabs on screen while the session list is still loading', () => {
    // The strip is restored from disk before the list has answered. Dropping every tab
    // it names until then makes the whole strip appear out of nothing a moment into
    // boot — a tab is only STALE once a list that loaded fails to name it.
    publish({ data: { sessions: { status: 'loading' } }, ui: { activeSessionId: undefined } });
    useShell.getState().openTab('c1');
    useShell.getState().openTab('c2');
    render(<Center />);
    expect(screen.getAllByRole('button', { name: '…' })).toHaveLength(2);
  });

  it('drops a tab the loaded list does not name — that one really is gone', () => {
    publish();
    useShell.getState().openTab('c1');
    useShell.getState().openTab('from-another-project');
    render(<Center />);
    expect(screen.getByRole('button', { name: /wire the dock/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '…' })).toBeNull();
  });

  it('gives every session tab the same fixed width (titles truncate inside)', () => {
    publish();
    useShell.getState().openTab('c1');
    useShell.getState().openTab('c2');
    render(<Center />);
    const tab = screen.getByRole('button', { name: /wire the dock/ });
    // exact width + flex-none: the row can neither grow nor compress a tab
    expect(tab.className).toContain('w-30');
    expect(tab.className).toContain('flex-none');
    expect(tab.className).not.toContain('max-w-52');
  });

  it('marks the clicked tab selected in the same frame as the click', () => {
    // `activateSession` flips the active id synchronously and only then materializes, so the
    // strip can read selection straight from the slice — no optimistic marker, no transition.
    // The mock mirrors that first synchronous act; the assertions run with nothing awaited.
    publish({ actions: { selectSession: (id: string) => setActiveSession(id) } });
    useShell.getState().openTab('c1');
    useShell.getState().openTab('c2');
    render(<Center />);
    const c2 = screen.getByRole('button', { name: /fix the seam/ });
    act(() => {
      fireEvent.click(c2);
    });
    expect(c2.className).toContain('text-s12');
    expect(screen.getByRole('button', { name: /wire the dock/ }).className).toContain('text-s9');
  });

  it('parts every tab from its neighbour with a hairline, selected ones included', () => {
    publish({ ui: { activeSessionId: 'c2' } });
    useShell.getState().openTab('c1');
    useShell.getState().openTab('c2');
    render(<Center />);
    for (const name of [/wire the dock/, /fix the seam/]) {
      expect(screen.getByRole('button', { name }).querySelector('[data-divider]')).toBeTruthy();
    }
  });

  it('shows the raw indicator only while raw mode is on', () => {
    publish({ ui: { activeSessionId: 'c1', rawMode: true } });
    useShell.getState().openTab('c1');
    render(<Center />);
    expect(screen.getByText(/^raw$/i)).toBeTruthy();
  });

  it('middle-click closes a tab and falls the active selection to the last remaining', () => {
    const selectSession = publish();
    useShell.getState().openTab('c1');
    useShell.getState().openTab('c2');
    render(<Center />);
    // c1 is active; middle-press its tab → working set drops it, selection falls to c2.
    // (The PRESS, not auxclick: that's what beats Windows' autoscroll to the gesture.)
    fireEvent.mouseDown(screen.getByRole('button', { name: /wire the dock/ }), { button: 1 });
    expect(useShell.getState().tabs).toEqual(['c2']);
    expect(selectSession).toHaveBeenCalledWith('c2');
    // and the closed tab is on the reopen stack (ctrl+shift+t)
    expect(useShell.getState().closedTabs).toEqual(['c1']);
  });
});

describe('Center tab-strip new-session control', () => {
  it('the + control opens the agent picker — the same one ctrl+t opens', async () => {
    const user = userEvent.setup();
    publish();
    useShell.getState().openTab('c1');
    render(<Center />);
    await user.click(screen.getByRole('button', { name: /^new session$/i }));
    // one way to start a session: the control raises the picker, it doesn't grow its own menu
    expect(useShell.getState().newSessionOpen).toBe(true);
  });
});

describe('Center search morph', () => {
  it('swaps the strip and canvas into search mode and restores on cancel', () => {
    publish();
    useShell.getState().openTab('c1');
    render(<Center />);
    act(() => useShell.getState().openSearch());
    expect(screen.getByPlaceholderText(/^search sessions…$/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^cancel search$/i }));
    expect(useShell.getState().mode).toBe('work');
  });

  /** Label-adjacency law (UI.md): cancel is an icon-ONLY control, so its mark is drawn.
   *  The ⌕ beside it stays typed — it is ornament inside the field, not a control. */
  it('draws the cancel mark rather than typing one', () => {
    publish();
    useShell.getState().openTab('c1');
    render(<Center />);
    act(() => useShell.getState().openSearch());
    const cancel = screen.getByRole('button', { name: /^cancel search$/i });
    expect(cancel.querySelector('svg')).not.toBeNull();
    expect(cancel.textContent).toBe('');
  });

  it('grows a tooltip naming the search shortcut on the ⌕ control', async () => {
    const user = userEvent.setup();
    publish();
    useShell.getState().openTab('c1');
    render(<Center />);
    const btn = screen.getByRole('button', { name: /^search sessions$/i });
    for (let i = 0; i < 25 && document.activeElement !== btn; i++) await user.tab();
    expect(document.activeElement).toBe(btn);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(/search sessions/i);
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
    fireEvent.click(screen.getByRole('button', { name: /^cancel search$/i }));
    expect(container.querySelectorAll('[data-canvas="chat"]')).toHaveLength(1);
  });

  it('lets the search field shrink instead of colliding with the cancel control', () => {
    publish();
    useShell.getState().openTab('c1');
    render(<Center />);
    act(() => useShell.getState().openSearch());
    const input = screen.getByPlaceholderText(/^search sessions…$/i);
    const field = input.parentElement as HTMLElement;
    const row = field.parentElement as HTMLElement;
    // EVERY link in the chain must be able to shrink. A flex item's automatic minimum
    // size is its content, so a single missing min-w-0 anywhere here lets the search bar
    // overflow the column and land on top of the dock — measured, not theorised.
    for (const el of [input, field, row]) expect(el.className).toContain('min-w-0');
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
