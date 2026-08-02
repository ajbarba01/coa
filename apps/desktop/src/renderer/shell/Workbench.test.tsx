// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeState } from '../panels/fixtures.js';
import { useMockAuth } from '../panels/mockAuth.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { useShell } from './store.js';
import { CENTER, clampNav, clampWork, NAV, WORK, Workbench } from './Workbench.js';

const initialShell = useShell.getState();
const initialAuth = useMockAuth.getState();

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
  useMockAuth.setState(initialAuth, true);
  (window as unknown as { coa: unknown }).coa = { platform: 'win32' };
});

describe('column seams keep the center whole', () => {
  it('stops the nav seam where the center would drop below its floor', () => {
    // roomy window: the nav is free up to its own max
    expect(clampNav(500, 1600, WORK.base)).toBe(NAV.max);
    expect(clampNav(210, 1600, WORK.base)).toBe(210);
    // tight window: the center's floor bites first
    const tight = NAV.min + 60 + WORK.base + CENTER.min;
    expect(clampNav(999, tight, WORK.base)).toBe(NAV.min + 60);
    // and the nav still keeps its own min on a window too small for everything
    expect(clampNav(999, 600, WORK.base)).toBe(NAV.min);
  });

  it('caps the dock at the center’s floor without blocking its collapse', () => {
    expect(clampWork(WORK.base, 1600, NAV.base)).toBe(WORK.base);
    expect(clampWork(WORK.max, NAV.base + CENTER.min + 240, NAV.base)).toBe(240);
    // small drags pass through untouched — the collapse hysteresis owns them
    expect(clampWork(80, 1600, NAV.base)).toBe(80);
  });
});

describe('Workbench', () => {
  it('renders the nav, both resize seams, and the dock', () => {
    render(<Workbench />);
    expect(screen.getByRole('button', { name: /chat/i })).toBeTruthy();
    expect(screen.getAllByRole('separator', { name: /^resize panel$/i })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^hide session panel$/i })).toBeTruthy();
  });

  it('collapsing the dock leaves the reopen affordance', () => {
    render(<Workbench />);
    act(() => useShell.getState().setWorkOpen(false));
    expect(screen.getByRole('button', { name: /^show session panel$/i })).toBeTruthy();
    expect(screen.getAllByRole('separator', { name: /^resize panel$/i })).toHaveLength(1);
  });

  it('hosts the store-selected surface in the center once state is published', () => {
    publishConsoleState(makeState());
    useShell.getState().setSurface('graph');
    render(<Workbench />);
    expect(screen.getByText(/graph is not designed yet/i)).toBeTruthy();
  });

  it('renders no surface before the first console-state publish', () => {
    useShell.getState().setSurface('graph');
    render(<Workbench />);
    expect(screen.queryByText(/graph is not designed yet/i)).toBeNull();
  });

  it('routes the auth surface to its pane — credentials outgrew the ◐ foot popover', async () => {
    publishConsoleState(makeState());
    useShell.getState().setSurface('auth');
    // The auth store is empty until its mount-time `hydrate()` resolves (Task 10 — live
    // daemon reads); this file's `window.coa` stub carries no `authView`, so that read
    // rejects (swallowed, SC-1) and never populates the store. Seed directly instead —
    // this test is only routing, not auth's own render coverage (AuthPanel.test.tsx owns
    // that).
    useMockAuth.setState({ added: ['claude', 'tavily'], enabled: { claude: true, tavily: true } });
    render(<Workbench />);
    await waitFor(() => expect(screen.getByText(/^agent backends$/i)).toBeTruthy());
    expect(screen.getByText(/^tool services$/i)).toBeTruthy();
  });
});
