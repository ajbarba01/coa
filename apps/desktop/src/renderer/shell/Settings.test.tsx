// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState } from '../panels/fixtures.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { SettingsDialog } from './Settings.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

function open(setSettings = vi.fn()): ReturnType<typeof vi.fn> {
  publishConsoleState(makeState({ actions: { setSettings } }));
  useShell.getState().setSettingsOpen(true);
  render(<SettingsDialog />);
  return setSettings;
}

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
});

describe('SettingsDialog', () => {
  it('persists a motion change through the console settings action', () => {
    const setSettings = open();
    fireEvent.click(screen.getByRole('switch'));
    expect(setSettings).toHaveBeenCalledWith({ motion: 'reduce' });
  });

  it('shows the pinned theme as a read-only value', () => {
    open();
    expect(screen.getByText('sand dark')).toBeTruthy();
    // No theme control to operate — one switch (motion) and one select (density).
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });

  it('search filters rows and keybinds together', () => {
    open();
    fireEvent.change(screen.getByPlaceholderText('search settings…'), {
      target: { value: 'palette' },
    });
    expect(screen.getByText('command palette')).toBeTruthy();
    expect(screen.queryByText('Density')).toBeNull();
  });

  it('renders every keybind from the registry as chips', () => {
    open();
    expect(screen.getByText('command palette')).toBeTruthy();
    expect(screen.getByText('toggle the session panel')).toBeTruthy();
  });
});
