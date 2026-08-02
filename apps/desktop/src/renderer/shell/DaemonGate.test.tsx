// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonGate } from './DaemonGate.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

const start = vi.fn(() => Promise.resolve());

beforeEach(() => {
  useShell.setState(initialShell, true);
  (window as unknown as { coa: unknown }).coa = {
    platform: 'win32',
    daemon: { start },
    window: {
      minimize: () => Promise.resolve(),
      toggleMaximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
  };
});

afterEach(() => {
  start.mockClear();
});

describe('DaemonGate', () => {
  it('offers Start when the daemon is stopped and routes it to the daemon control', () => {
    useShell.getState().setDaemon('stopped');
    render(<DaemonGate />);
    expect(screen.getByText('the coa daemon is not running')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start daemon' }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('shows only the starting message while the daemon comes up', () => {
    useShell.getState().setDaemon('starting');
    render(<DaemonGate />);
    expect(screen.getByText('starting the coa daemon…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start daemon' })).toBeNull();
  });

  it('keeps the window chrome usable behind the gate', () => {
    useShell.getState().setDaemon('error');
    render(<DaemonGate />);
    expect(screen.getByText('the coa daemon hit an error')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^close$/i })).toBeTruthy();
  });

  it('retries start on an interval while the daemon stays down, and stops once it is up', () => {
    vi.useFakeTimers();
    try {
      useShell.getState().setDaemon('stopped');
      render(<DaemonGate />);
      vi.advanceTimersByTime(5000);
      expect(start).toHaveBeenCalledTimes(1);
      // A daemon that came up out-of-band must not be re-started by a stale tick.
      useShell.getState().setDaemon('running');
      vi.advanceTimersByTime(5000);
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
