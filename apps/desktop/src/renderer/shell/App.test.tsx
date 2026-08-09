// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { App } from '../App.js';
import { useConsoleState } from './consoleStore.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

/** A resolving stub for every bridge verb the composition root touches on
 *  mount, so the REAL App (controller + persistence + gate) can run in jsdom. Each read
 *  verb the boot sequence calls is a spy (not just a resolver), so a test can assert the
 *  F11 project-swap reboot actually re-ran it. */
function stubCoa(
  daemonStatus: 'running' | 'stopped',
  workspace = { name: 'coa', root: 'C:/dev/coa' },
) {
  const coa = {
    platform: 'win32',
    capState: vi.fn().mockResolvedValue({ remaining: 2, capHit: false }),
    flagsForUser: vi.fn().mockResolvedValue({ expanded: [], collapsed: [] }),
    listTimeline: vi.fn().mockResolvedValue([]),
    listAccounts: vi.fn().mockResolvedValue({ accounts: [], active: {} }),
    listModels: vi.fn().mockResolvedValue([]),
    listRoles: vi.fn().mockResolvedValue([]),
    listPackages: vi.fn().mockResolvedValue([]),
    listAgents: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue([]),
    getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
    saveSettings: () => Promise.resolve(),
    getLayout: () => Promise.resolve(undefined),
    saveLayout: () => Promise.resolve(),
    getWorkspace: vi.fn().mockResolvedValue(workspace),
    listRecentProjects: vi.fn().mockResolvedValue([]),
    pickDirectory: vi.fn().mockResolvedValue({}),
    openProject: vi.fn(),
    onPush: () => () => {},
    daemon: {
      status: () => Promise.resolve({ status: daemonStatus }),
      onStatus: () => () => {},
      start: () => Promise.resolve(),
      adopt: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      restart: () => Promise.resolve(),
    },
    window: {
      minimize: () => Promise.resolve(),
      toggleMaximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
      onMaximizeChange: () => () => {},
    },
  };
  (window as unknown as { coa: unknown }).coa = coa;
  return coa;
}

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
});

describe('App', () => {
  it('yields the whole window to the gate while the daemon is down', async () => {
    stubCoa('stopped');
    render(<App />);
    expect(await screen.findByText('The coa daemon is not running.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /timeline/i })).toBeNull();
  });

  it('swaps to the workbench once the daemon reports running', async () => {
    stubCoa('running');
    render(<App />);
    expect(await screen.findByRole('button', { name: /timeline/i })).toBeTruthy();
    expect(screen.queryByText('The coa daemon is not running.')).toBeNull();
  });

  it("reads this window's own bound project from getWorkspace on mount (F11 launch-restore)", async () => {
    stubCoa('running', { name: 'other-project', root: 'D:/elsewhere/other-project' });
    render(<App />);
    // Each restored window fetches its OWN root — this is what makes launch-restore work
    // without any extra plumbing: a window bound to a different project on relaunch shows
    // that project's name, not a hardcoded one.
    expect(await screen.findByText('other-project')).toBeTruthy();
  });

  it('tears down and reboots the console controller when the shell reports a project swap', async () => {
    const coa = stubCoa('running');
    render(<App />);
    await screen.findByRole('button', { name: /timeline/i });
    const bootCalls = coa.listSessions.mock.calls.length;
    expect(bootCalls).toBeGreaterThan(0);

    // Simulate what ProjectSwitcher does on a real swap: adopt the new workspace and bump
    // projectEpoch — the composition root should tear the old controller down and boot a
    // fresh one exactly like a new window, re-running the same boot reads.
    useShell.getState().applyProjectSwitch({ name: 'other', root: 'D:/elsewhere/other' });

    await screen.findByText('other');
    await waitFor(() => expect(coa.listSessions.mock.calls.length).toBeGreaterThan(bootCalls));
  });
});
