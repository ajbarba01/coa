// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDismissLayer } from '@coa/console-kit';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { makeState } from '../panels/fixtures.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { DEFAULT_KEYBINDS } from './keybinds.js';
import { useGlobalKeys } from './keys.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

function Keys(): null {
  useGlobalKeys();
  return null;
}

function OpenLayer(): null {
  useDismissLayer(true, () => {});
  return null;
}

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
});

describe('useGlobalKeys', () => {
  it('dispatches the registry binds into the shell store', () => {
    render(<Keys />);
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(useShell.getState().workOpen).toBe(false);
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    expect(useShell.getState().settingsOpen).toBe(true);
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    expect(useShell.getState().mode).toBe('search');
    expect(useShell.getState().surface).toBe('chat');
  });

  it('Escape with no open layer stops the running turn (SC-1 advisory)', () => {
    const interruptSession = vi.fn();
    publishConsoleState(
      makeState({
        ui: { activeSessionId: 'c1', runStatus: { c1: { since: 1 } } },
        actions: { interruptSession },
      }),
    );
    render(<Keys />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(interruptSession).toHaveBeenCalledWith('c1');
  });

  it('Escape defers to an open dismiss layer and never double-fires', () => {
    const interruptSession = vi.fn();
    publishConsoleState(
      makeState({
        ui: { activeSessionId: 'c1', runStatus: { c1: { since: 1 } } },
        actions: { interruptSession },
      }),
    );
    render(
      <>
        <Keys />
        <OpenLayer />
      </>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(interruptSession).not.toHaveBeenCalled();
  });

  it('Escape while idle is a no-op', () => {
    const interruptSession = vi.fn();
    publishConsoleState(makeState({ actions: { interruptSession } }));
    render(<Keys />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(interruptSession).not.toHaveBeenCalled();
  });

  it('Ctrl+P toggles search — a second press exits it', () => {
    render(<Keys />);
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    expect(useShell.getState().mode).toBe('search');
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    expect(useShell.getState().mode).toBe('work');
  });

  it('Ctrl+P over an open dialog swaps — the dialog closes and search comes forward', () => {
    render(<Keys />);
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    expect(useShell.getState().settingsOpen).toBe(true);
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    expect(useShell.getState().settingsOpen).toBe(false);
    expect(useShell.getState().mode).toBe('search');
  });

  it('lists find-in-conversation in the registry (a bind cannot exist undiscoverable)', () => {
    expect(DEFAULT_KEYBINDS.some((k) => k.keys.join('+') === 'ctrl+f')).toBe(true);
  });

  it('dispatches a REBOUND chord, and the default it replaced goes dead', () => {
    publishConsoleState(
      makeState({
        ui: { settings: { ...DEFAULT_SETTINGS, keybinds: { 'toggle-dock': ['ctrl', 'j'] } } },
      }),
    );
    render(<Keys />);
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(useShell.getState().workOpen).toBe(false);
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true }); // the old chord no longer answers
    expect(useShell.getState().workOpen).toBe(false);
  });
});

describe('tab commands', () => {
  /** Three open tabs, all three REAL sessions — the keyboard only walks what the strip
   *  renders, so the session list is what makes a tab reachable. */
  const publishTabs = (
    activeSessionId: string,
    tabs = ['a', 'b', 'c'],
  ): ReturnType<typeof vi.fn> => {
    const selectSession = vi.fn();
    publishConsoleState(
      makeState({
        data: {
          sessions: {
            status: 'ok',
            value: ['a', 'b', 'c'].map((id) => ({
              id,
              title: id,
              agentRef: 'roles/dev',
              updatedAt: '2026-07-11T00:00:00.000Z',
            })),
          },
        },
        ui: { activeSessionId },
        actions: { selectSession },
      }),
    );
    useShell.setState({ tabs });
    return selectSession;
  };

  it('ctrl+tab and ctrl+shift+tab walk the strip, wrapping at both ends', () => {
    const selectSession = publishTabs('c');
    render(<Keys />);
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    expect(selectSession).toHaveBeenLastCalledWith('a'); // wrapped past the end

    publishTabs('a');
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(selectSession).toHaveBeenLastCalledWith('a');
  });

  it('cycles only the tabs the strip renders — a working-set id with no session is skipped', () => {
    // 'ghost' is in the working set but the daemon doesn't list it, so the strip draws
    // nothing for it. The keyboard must not stop on a tab that isn't there.
    const selectSession = publishTabs('a', ['a', 'ghost', 'b']);
    render(<Keys />);
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    expect(selectSession).toHaveBeenLastCalledWith('b'); // not 'ghost'

    fireEvent.keyDown(window, { key: '2', ctrlKey: true });
    expect(selectSession).toHaveBeenLastCalledWith('b'); // position counts the visible tabs
  });

  it('ctrl+1…9 jumps by position, 9 meaning the last tab', () => {
    const selectSession = publishTabs('a');
    render(<Keys />);
    fireEvent.keyDown(window, { key: '2', ctrlKey: true });
    expect(selectSession).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(window, { key: '9', ctrlKey: true });
    expect(selectSession).toHaveBeenLastCalledWith('c');
    selectSession.mockClear();
    fireEvent.keyDown(window, { key: '7', ctrlKey: true }); // past the end: nothing to jump to
    expect(selectSession).not.toHaveBeenCalled();
  });

  it('ctrl+w closes the active tab and falls the selection to a neighbour', () => {
    const selectSession = publishTabs('c');
    render(<Keys />);
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    expect(useShell.getState().tabs).toEqual(['a', 'b']);
    expect(selectSession).toHaveBeenLastCalledWith('b');
  });

  it('ctrl+w with no tabs open is a no-op — it never closes the window', () => {
    publishConsoleState(makeState({ ui: {} }));
    useShell.setState({ tabs: [] });
    render(<Keys />);
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    expect(useShell.getState().tabs).toEqual([]);
  });

  it('ctrl+shift+t reopens the last closed tab and makes it active, most recent first', () => {
    const selectSession = publishTabs('c');
    render(<Keys />);
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true }); // close c
    expect(useShell.getState().tabs).toEqual(['a', 'b']);

    fireEvent.keyDown(window, { key: 'T', ctrlKey: true, shiftKey: true });
    expect(useShell.getState().tabs).toEqual(['a', 'b', 'c']);
    expect(selectSession).toHaveBeenLastCalledWith('c');

    // the stack is empty now: a second reopen has nothing to bring back
    selectSession.mockClear();
    fireEvent.keyDown(window, { key: 'T', ctrlKey: true, shiftKey: true });
    expect(useShell.getState().tabs).toEqual(['a', 'b', 'c']);
    expect(selectSession).not.toHaveBeenCalled();
  });

  it('ctrl+t opens the agent picker', () => {
    publishTabs('a');
    render(<Keys />);
    fireEvent.keyDown(window, { key: 't', ctrlKey: true });
    expect(useShell.getState().newSessionOpen).toBe(true);
  });

  it('the tab commands are scoped to chat — they never reach in from another surface', () => {
    const selectSession = publishTabs('c');
    useShell.setState({ surface: 'agents' });
    render(<Keys />);

    // The bug this scope exists for: ctrl+w on the agents surface closing a chat session
    // with nothing to show for it.
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    expect(useShell.getState().tabs).toEqual(['a', 'b', 'c']);
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    fireEvent.keyDown(window, { key: '1', ctrlKey: true });
    expect(selectSession).not.toHaveBeenCalled();

    // …and the global commands still answer from anywhere.
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(useShell.getState().workOpen).toBe(false);
  });

  it('Enter in the conversation takes the user to the composer instead of doing nothing', () => {
    publishTabs('a');
    render(<Keys />);
    const before = useShell.getState().composerFocus;
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(useShell.getState().composerFocus).toBe(before + 1);
  });

  it('Enter leaves a field alone — a field’s keys are the field’s', () => {
    publishTabs('a');
    const { container } = render(<Keys />);
    const input = document.createElement('input');
    container.append(input);
    const before = useShell.getState().composerFocus;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useShell.getState().composerFocus).toBe(before);
  });

  it('opening a session hands the caret to the composer', () => {
    publishConsoleState(makeState({ ui: { activeSessionId: 'a' } }));
    const before = useShell.getState().composerFocus;
    useShell.getState().openTab('a');
    expect(useShell.getState().composerFocus).toBe(before + 1);
  });

  it('the tab commands stand down while a dialog is over the chat surface', () => {
    publishTabs('c');
    render(<Keys />);
    useShell.getState().setPaletteOpen(true);
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    expect(useShell.getState().tabs).toEqual(['a', 'b', 'c']);
  });
});
