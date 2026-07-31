// @vitest-environment jsdom
import type { TurnFrame } from '@coa/console-viewmodel';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeState } from '../panels/fixtures.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { useShell } from './store.js';
import { Work } from './Work.js';

const initialShell = useShell.getState();

const SESSION = {
  id: 'c1',
  title: 'wire the dock',
  agentRef: 'roles/dev',
  updatedAt: '2026-07-11T00:00:00.000Z',
};

function publish(runStatus: Record<string, { since: number }> = {}): void {
  publishConsoleState(
    makeState({
      data: { sessions: { status: 'ok', value: [SESSION] } },
      ui: { activeSessionId: 'c1', runStatus },
    }),
  );
}

function renderWorkWithTurns(turns: TurnFrame[]): void {
  publishConsoleState(
    makeState({
      data: { sessions: { status: 'ok', value: [SESSION] }, turns: { status: 'ok', value: turns } },
      ui: { activeSessionId: 'c1' },
    }),
  );
  render(<Work />);
}

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
  (window as unknown as { coa: unknown }).coa = { platform: 'win32' };
});

describe('Work', () => {
  it('shows the active session as the root row with its real run status', () => {
    publish({ c1: { since: 1 } });
    render(<Work />);
    expect(screen.getByText('wire the dock')).toBeTruthy();
    expect(screen.getByText('root')).toBeTruthy();
  });

  it('falls to the quiet empty line with no active session', () => {
    publishConsoleState(makeState({ data: { sessions: { status: 'ok', value: [] } } }));
    render(<Work />);
    expect(screen.getByText('no session')).toBeTruthy();
  });

  it('collapses through the foot control', () => {
    publish();
    render(<Work />);
    fireEvent.click(screen.getByRole('button', { name: 'hide session panel' }));
    expect(useShell.getState().workOpen).toBe(false);
  });

  it('carries the window controls in its title-bar segment', () => {
    publish();
    render(<Work />);
    expect(screen.getByRole('button', { name: 'close' })).toBeTruthy();
  });

  it('shows the agent plan checklist from the active session plan frame', () => {
    renderWorkWithTurns([
      {
        id: 'p1',
        role: 'agent',
        kind: 'plan',
        items: [
          { text: 'wire the surface', status: 'in-progress' },
          { text: 'read the spec', status: 'done' },
        ],
      },
    ]);
    expect(screen.getByText('wire the surface')).toBeTruthy();
    expect(screen.getByText('read the spec')).toBeTruthy();
  });

  it('labels the un-backed sections as floors, not fake data', () => {
    renderWorkWithTurns([]);
    expect(screen.getAllByText(/not tracked yet/i).length).toBeGreaterThan(0);
  });
});
