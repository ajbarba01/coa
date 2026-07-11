// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { App } from '../App.js';
import { useConsoleState } from './consoleStore.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

/** A resolving stub for every bridge verb the composition root touches on
 *  mount, so the REAL App (controller + persistence + gate) can run in jsdom. */
function stubCoa(daemonStatus: 'running' | 'stopped'): void {
  (window as unknown as { coa: unknown }).coa = {
    platform: 'win32',
    capState: () => Promise.resolve({ remaining: 2, capHit: false }),
    flagsForUser: () => Promise.resolve({ expanded: [], collapsed: [] }),
    listTimeline: () => Promise.resolve([]),
    listAccounts: () => Promise.resolve({ accounts: [], active: {} }),
    listModels: () => Promise.resolve([]),
    listRoles: () => Promise.resolve([]),
    listPackages: () => Promise.resolve([]),
    listAgents: () => Promise.resolve([]),
    listSessions: () => Promise.resolve([]),
    getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
    saveSettings: () => Promise.resolve(),
    getLayout: () => Promise.resolve(undefined),
    saveLayout: () => Promise.resolve(),
    getWorkspace: () => Promise.resolve({ name: 'coa', root: 'C:/dev/coa' }),
    onPush: () => () => {},
    daemon: {
      status: () => Promise.resolve(daemonStatus),
      onStatus: () => () => {},
      start: () => Promise.resolve(),
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
}

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
});

describe('App', () => {
  it('yields the whole window to the gate while the daemon is down', async () => {
    stubCoa('stopped');
    render(<App />);
    expect(await screen.findByText('the coa daemon is not running')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /timeline/ })).toBeNull();
  });

  it('swaps to the workbench once the daemon reports running', async () => {
    stubCoa('running');
    render(<App />);
    expect(await screen.findByRole('button', { name: /timeline/ })).toBeTruthy();
    expect(screen.queryByText('the coa daemon is not running')).toBeNull();
  });
});
