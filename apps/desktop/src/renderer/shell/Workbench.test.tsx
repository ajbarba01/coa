// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores, seedStores } from '../testing/fixtures.js';
import { useAuthStore } from '../panels/authStore.js';
import { useShell } from './store.js';
import { CENTER, clampNav, clampWork, NAV, WORK, Workbench } from './Workbench.js';

const initialShell = useShell.getState();
const initialAuth = useAuthStore.getState();

beforeEach(() => {
  useShell.setState(initialShell, true);
  resetStores();
  useAuthStore.setState(initialAuth, true);
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

  it('hosts the store-selected surface in the center', () => {
    seedStores();
    useShell.getState().setSurface('graph');
    render(<Workbench />);
    expect(screen.getByText(/graph is not designed yet/i)).toBeTruthy();
  });

  it('renders its surface with no seeding at all — slices carry their own defaults', () => {
    // The old whole-state store held `undefined` until the first publish and the center
    // rendered nothing until then. Slices are always readable, so a surface paints on the
    // first frame; that gap is what instant navigation removes.
    useShell.getState().setSurface('graph');
    render(<Workbench />);
    expect(screen.getByText(/graph is not designed yet/i)).toBeTruthy();
  });

  it('routes the auth surface to its pane — credentials outgrew the ◐ foot popover', async () => {
    seedStores();
    useShell.getState().setSurface('auth');
    // The auth store is empty until its mount-time `hydrate()` resolves (the live
    // daemon reads land later); this file's `window.coa` stub carries no `authView`, so that read
    // rejects (swallowed — surfacing failures never block) and never populates the store. Seed directly instead —
    // this test is only routing, not auth's own render coverage (AuthPanel.test.tsx owns
    // that).
    useAuthStore.setState({ added: ['claude', 'tavily'], enabled: { claude: true, tavily: true } });
    render(<Workbench />);
    await waitFor(() => expect(screen.getByText(/^agent backends$/i)).toBeTruthy());
    expect(screen.getByText(/^tool services$/i)).toBeTruthy();
  });
});
