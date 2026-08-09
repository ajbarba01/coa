// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonGate } from './DaemonGate.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

const start = vi.fn(() => Promise.resolve());
const adopt = vi.fn(() => Promise.resolve());

beforeEach(() => {
  useShell.setState(initialShell, true);
  (window as unknown as { coa: unknown }).coa = {
    platform: 'win32',
    daemon: { start, adopt },
    window: {
      minimize: () => Promise.resolve(),
      toggleMaximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
  };
});

afterEach(() => {
  start.mockClear();
  adopt.mockClear();
});

describe('DaemonGate', () => {
  it('offers Start when the daemon is stopped and routes it to the daemon control', () => {
    useShell.getState().setDaemon('stopped');
    render(<DaemonGate />);
    expect(screen.getByText('The coa daemon is not running.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start daemon' }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('shows only the starting message while the daemon comes up', () => {
    useShell.getState().setDaemon('starting');
    render(<DaemonGate />);
    expect(screen.getByText('Starting the coa daemon…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start daemon' })).toBeNull();
  });

  it('keeps the window chrome usable behind the gate', () => {
    useShell.getState().setDaemon('error');
    render(<DaemonGate />);
    expect(screen.getByText('The coa daemon hit an error.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^close$/i })).toBeTruthy();
  });

  it('retries start on an interval while the daemon stays down, and stops once it is up', () => {
    vi.useFakeTimers();
    try {
      useShell.getState().setDaemon('stopped');
      render(<DaemonGate />);
      act(() => vi.advanceTimersByTime(5000));
      expect(start).toHaveBeenCalledTimes(1);
      // A daemon that came up out-of-band must not be re-started by a stale tick.
      act(() => useShell.getState().setDaemon('running'));
      act(() => vi.advanceTimersByTime(5000));
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says WHY the daemon failed, not just that it did', () => {
    useShell.getState().setDaemon('error', "Error: Cannot find module 'better-sqlite3'");
    render(<DaemonGate />);
    expect(screen.getByText('The coa daemon hit an error.')).toBeTruthy();
    expect(screen.getByText("Error: Cannot find module 'better-sqlite3'")).toBeTruthy();
  });

  it('stops relaunching after the same failure repeats, but keeps adopting an out-of-band daemon', () => {
    vi.useFakeTimers();
    try {
      useShell.getState().setDaemon('error', 'port already in use');
      render(<DaemonGate />);
      // Five identical failures still get a relaunch each — a transient cause deserves them.
      act(() => vi.advanceTimersByTime(5 * 5000));
      expect(start).toHaveBeenCalledTimes(5);
      expect(adopt).not.toHaveBeenCalled();

      // Past that, the gate stops spawning and only attaches to a daemon already serving.
      act(() => vi.advanceTimersByTime(2 * 5000));
      expect(start).toHaveBeenCalledTimes(5);
      expect(adopt).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/retrying automatically has stopped/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a different failure is a different problem — the relaunch tally starts over', () => {
    vi.useFakeTimers();
    try {
      useShell.getState().setDaemon('error', 'port already in use');
      render(<DaemonGate />);
      act(() => vi.advanceTimersByTime(6 * 5000));
      expect(adopt).toHaveBeenCalledTimes(1);

      act(() => useShell.getState().setDaemon('error', 'permission denied'));
      act(() => vi.advanceTimersByTime(5000));
      expect(start).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the button is a fresh ask: it relaunches and re-arms the automatic retry', () => {
    vi.useFakeTimers();
    try {
      useShell.getState().setDaemon('error', 'port already in use');
      render(<DaemonGate />);
      act(() => vi.advanceTimersByTime(6 * 5000));
      expect(adopt).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Start daemon' }));
      expect(start).toHaveBeenCalledTimes(6);
      act(() => vi.advanceTimersByTime(5000));
      expect(start).toHaveBeenCalledTimes(7); // spawning again, not adopting
      expect(adopt).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
