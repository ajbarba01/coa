// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState, resetStores, seedState } from '../testing/fixtures.js';
import { Palette } from './Palette.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

beforeEach(() => {
  useShell.setState(initialShell, true);
  resetStores();
});

function open(overrides: Parameters<typeof makeState>[0] = {}): void {
  seedState(makeState(overrides));
  useShell.getState().setPaletteOpen(true);
}

describe('Palette', () => {
  it('renders nothing while closed', () => {
    seedState(makeState());
    const { container } = render(<Palette />);
    expect(container.firstChild).toBeNull();
  });

  it('toggles raw mode through the console action and closes', () => {
    const toggleRaw = vi.fn();
    open({ actions: { toggleRaw } });
    render(<Palette />);
    fireEvent.click(screen.getByText(/show the unfiltered loop/i));
    expect(toggleRaw).toHaveBeenCalledTimes(1);
    expect(useShell.getState().paletteOpen).toBe(false);
  });

  it('offers interrupt only while the active session runs', () => {
    const interruptSession = vi.fn();
    open({
      ui: { activeSessionId: 'c1', runStatus: { c1: { since: 1 } } },
      actions: { interruptSession },
    });
    render(<Palette />);
    fireEvent.click(screen.getByText(/^interrupt running turn$/i));
    expect(interruptSession).toHaveBeenCalledWith('c1');
  });

  it('keeps interrupt inert while idle', () => {
    const interruptSession = vi.fn();
    open({ actions: { interruptSession } });
    render(<Palette />);
    const item = screen.getByText(/^interrupt running turn$/i).closest('[cmdk-item]');
    expect(item?.getAttribute('aria-disabled')).toBe('true');
  });

  it('navigates surfaces', () => {
    open();
    render(<Palette />);
    fireEvent.click(screen.getByText(/^timeline$/i));
    expect(useShell.getState().surface).toBe('timeline');
  });
});
