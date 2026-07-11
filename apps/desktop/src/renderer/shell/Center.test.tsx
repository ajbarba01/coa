// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState } from '../panels/fixtures.js';
import { Center } from './Center.js';
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
});
