// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FeedView } from '@coa/console-viewmodel';
import { makeState } from '../panels/fixtures.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { Nav, critCount } from './Nav.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
});

const flag = (severity: 'crit' | 'high', fingerprint: string): FeedView['expanded'][number] => ({
  ruleId: 'ssot',
  location: 'pay.ts:10',
  severity,
  message: 'generated stale',
  fingerprint,
  type: 1,
  confidence: 'high',
  concernKey: fingerprint,
});

describe('critCount', () => {
  it('counts only critical flags and treats unresolved reads as zero', () => {
    expect(critCount(undefined)).toBe(0);
    expect(critCount({ status: 'loading' })).toBe(0);
    expect(critCount({ status: 'error', message: 'x' })).toBe(0);
    expect(
      critCount({
        status: 'ok',
        value: { expanded: [flag('crit', 'a'), flag('high', 'b')], collapsed: [] },
      }),
    ).toBe(1);
  });
});

describe('Nav', () => {
  it('routes a surface row click through the shell store', () => {
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: /timeline/ }));
    expect(useShell.getState().surface).toBe('timeline');
  });

  it('wears the red count on flags only when criticals exist', () => {
    const { rerender } = render(<Nav />);
    // No published state yet — no count anywhere.
    expect(screen.queryByText('2')).toBeNull();
    publishConsoleState(
      makeState({
        data: {
          flags: {
            status: 'ok',
            value: { expanded: [flag('crit', 'a'), flag('crit', 'b')], collapsed: [] },
          },
        },
      }),
    );
    rerender(<Nav />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('opens settings from the foot and routes the account foot to its surface', () => {
    render(<Nav />);
    fireEvent.click(screen.getByRole('button', { name: 'settings' }));
    expect(useShell.getState().settingsOpen).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'account' }));
    expect(useShell.getState().surface).toBe('account');
  });

  it('names the project from the workspace main reports', () => {
    useShell.getState().setWorkspace({ name: 'coa', root: 'C:/dev/coa' });
    render(<Nav />);
    expect(screen.getByText('coa')).toBeTruthy();
  });
});
