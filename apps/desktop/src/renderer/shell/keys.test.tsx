// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDismissLayer } from '@coa/console-kit';
import { makeState } from '../panels/fixtures.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { KEYBINDS, useGlobalKeys } from './keys.js';
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
    expect(KEYBINDS.some((k) => k.keys.join('+') === 'ctrl+f')).toBe(true);
  });
});
