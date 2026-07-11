// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeState } from '../panels/fixtures.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { useShell } from './store.js';
import { Workbench } from './Workbench.js';

const initialShell = useShell.getState();

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
  (window as unknown as { coa: unknown }).coa = { platform: 'win32' };
});

describe('Workbench', () => {
  it('renders the nav, both resize seams, and the dock', () => {
    render(<Workbench />);
    expect(screen.getByRole('button', { name: /chat/ })).toBeTruthy();
    expect(screen.getAllByRole('separator', { name: 'resize panel' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'hide session panel' })).toBeTruthy();
  });

  it('collapsing the dock leaves the reopen affordance', () => {
    render(<Workbench />);
    act(() => useShell.getState().setWorkOpen(false));
    expect(screen.getByRole('button', { name: 'show session panel' })).toBeTruthy();
    expect(screen.getAllByRole('separator', { name: 'resize panel' })).toHaveLength(1);
  });

  it('hosts the store-selected surface in the center once state is published', () => {
    publishConsoleState(makeState());
    useShell.getState().setSurface('graph');
    render(<Workbench />);
    expect(screen.getByText(/graph isn't designed yet/)).toBeTruthy();
  });

  it('renders no surface before the first console-state publish', () => {
    useShell.getState().setSurface('graph');
    render(<Workbench />);
    expect(screen.queryByText(/graph isn't designed yet/)).toBeNull();
  });

  it('routes the account surface (nav foot ◐) to the AccountSurface pane', () => {
    publishConsoleState(makeState());
    useShell.getState().setSurface('account');
    render(<Workbench />);
    expect(screen.getByText('Accounts')).toBeTruthy();
  });
});
