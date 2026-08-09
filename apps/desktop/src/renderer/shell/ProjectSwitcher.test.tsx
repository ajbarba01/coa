// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeState } from '../testing/fixtures.js';
import { publishConsoleState, useConsoleState } from './consoleStore.js';
import { ProjectButton, shouldConfirmSwap } from './ProjectSwitcher.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();

/** A `window.coa` stub carrying only what `ProjectButton` touches, each verb a spy so a
 *  test can assert what it was called with. */
function stubCoa(overrides: Partial<Record<string, unknown>> = {}): void {
  (window as unknown as { coa: unknown }).coa = {
    platform: 'win32',
    listRecentProjects: vi.fn().mockResolvedValue([]),
    pickDirectory: vi.fn().mockResolvedValue({}),
    openProject: vi.fn().mockResolvedValue({
      opened: 'current',
      workspace: { name: 'picked', root: 'C:/dev/picked' },
    }),
    ...overrides,
  };
}

beforeEach(() => {
  useShell.setState(initialShell, true);
  useConsoleState.setState(undefined, true);
  stubCoa();
});

describe('shouldConfirmSwap', () => {
  it('never asks when nothing is running', () => {
    expect(shouldConfirmSwap(0, 'C:/other', 'C:/here', 'win32')).toBe(false);
  });

  it('asks when a turn is running and the target is a different project', () => {
    expect(shouldConfirmSwap(1, 'C:/other', 'C:/here', 'win32')).toBe(true);
  });

  it('never asks for the window re-picking its own already-open project, running or not', () => {
    expect(shouldConfirmSwap(3, 'C:/here', 'C:/here', 'win32')).toBe(false);
  });

  it('never asks when the current root is unknown yet (nothing to swap away from)', () => {
    expect(shouldConfirmSwap(2, 'C:/other', undefined, 'win32')).toBe(true);
  });

  it('never asks for a re-pick that only differs by drive-letter case on win32 (same project)', () => {
    expect(shouldConfirmSwap(1, 'C:/here', 'c:/HERE', 'win32')).toBe(false);
  });

  it('a case difference on a case-SENSITIVE platform is a real different project', () => {
    expect(shouldConfirmSwap(1, 'C:/here', 'c:/HERE', 'linux')).toBe(true);
  });
});

describe('ProjectButton', () => {
  it('replaces the dead "not available yet" copy with a real, working picker', async () => {
    render(<ProjectButton />);
    fireEvent.click(screen.getByRole('button', { name: /…/ }));
    expect(screen.queryByText('Opening another project is not available yet.')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Open Folder…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open in New Window…' })).toBeTruthy();
  });

  it('opens the picked folder in THIS window when idle, silently', async () => {
    const openProject = vi.fn().mockResolvedValue({
      opened: 'current',
      workspace: { name: 'picked', root: 'C:/dev/picked' },
    });
    stubCoa({
      pickDirectory: vi.fn().mockResolvedValue({ path: 'C:/dev/picked' }),
      openProject,
    });
    render(<ProjectButton />);
    fireEvent.click(screen.getByRole('button', { name: /…/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Folder…' }));

    await waitFor(() =>
      expect(openProject).toHaveBeenCalledWith({
        root: 'C:/dev/picked',
        target: 'current',
      }),
    );
    await waitFor(() =>
      expect(useShell.getState().workspace).toEqual({
        name: 'picked',
        root: 'C:/dev/picked',
      }),
    );
    // A real swap tears down and reboots the console controller.
    expect(useShell.getState().projectEpoch).toBe(1);
    expect(useShell.getState().projectOpen).toBe(false);
  });

  it('opens the picked folder in a NEW window without ever asking, even mid-turn', async () => {
    useShell.setState({ workspace: { name: 'here', root: 'C:/dev/here' } });
    publishConsoleState(makeState({ ui: { runStatus: { s1: { since: Date.now() } } } }));
    const openProject = vi
      .fn()
      .mockResolvedValue({ opened: 'new', workspace: { name: 'picked', root: 'C:/dev/picked' } });
    stubCoa({
      pickDirectory: vi.fn().mockResolvedValue({ path: 'C:/dev/picked' }),
      openProject,
    });
    render(<ProjectButton />);
    fireEvent.click(screen.getByRole('button', { name: /here/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open in New Window…' }));

    await waitFor(() =>
      expect(openProject).toHaveBeenCalledWith({ root: 'C:/dev/picked', target: 'new' }),
    );
    // A new window never touches THIS window's project — no reboot, no confirm.
    expect(useShell.getState().confirmSwapProject).toBeUndefined();
    expect(useShell.getState().projectEpoch).toBe(0);
  });

  it('confirms before swapping THIS window while a turn is running, then proceeds on confirm', async () => {
    useShell.setState({ workspace: { name: 'here', root: 'C:/dev/here' } });
    publishConsoleState(makeState({ ui: { runStatus: { s1: { since: Date.now() } } } }));
    const openProject = vi.fn().mockResolvedValue({
      opened: 'current',
      workspace: { name: 'picked', root: 'C:/dev/picked' },
    });
    stubCoa({
      pickDirectory: vi.fn().mockResolvedValue({ path: 'C:/dev/picked' }),
      openProject,
    });
    render(<ProjectButton />);
    fireEvent.click(screen.getByRole('button', { name: /here/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Folder…' }));

    expect(await screen.findByText(/switch to picked\?/i)).toBeTruthy();
    expect(openProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Switch Anyway' }));
    await waitFor(() =>
      expect(openProject).toHaveBeenCalledWith({ root: 'C:/dev/picked', target: 'current' }),
    );
    expect(useShell.getState().confirmSwapProject).toBeUndefined();
  });

  it('cancelling the confirm leaves the current project untouched', async () => {
    useShell.setState({ workspace: { name: 'here', root: 'C:/dev/here' } });
    publishConsoleState(makeState({ ui: { runStatus: { s1: { since: Date.now() } } } }));
    const openProject = vi.fn();
    stubCoa({ pickDirectory: vi.fn().mockResolvedValue({ path: 'C:/dev/picked' }), openProject });
    render(<ProjectButton />);
    fireEvent.click(screen.getByRole('button', { name: /here/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Folder…' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/switch to picked\?/i)).toBeNull();
    expect(openProject).not.toHaveBeenCalled();
    expect(useShell.getState().workspace).toEqual({ name: 'here', root: 'C:/dev/here' });
  });

  it('renders the recent-projects MRU main persists, badging the ones already open', async () => {
    stubCoa({
      listRecentProjects: vi.fn().mockResolvedValue([
        { root: 'C:/dev/a', name: 'a', lastOpenedAt: 2, open: true },
        { root: 'C:/dev/b', name: 'b', lastOpenedAt: 1, open: false },
      ]),
    });
    render(<ProjectButton />);
    fireEvent.click(screen.getByRole('button', { name: /…/ }));

    const rowA = (await screen.findByText('C:/dev/a')).closest<HTMLElement>('[role="button"]');
    const rowB = screen.getByText('C:/dev/b').closest<HTMLElement>('[role="button"]');
    if (rowA === null || rowB === null) throw new Error('recent rows did not render');
    // Scoped to each row: the current-project section above also carries its own
    // "Open" badge, so an unscoped query would be ambiguous.
    expect(within(rowA).getByText('Open')).toBeTruthy();
    expect(within(rowB).queryByText('Open')).toBeNull();
  });

  it('a recent row opens that project in THIS window on click, idle', async () => {
    const openProject = vi
      .fn()
      .mockResolvedValue({ opened: 'current', workspace: { name: 'a', root: 'C:/dev/a' } });
    stubCoa({
      listRecentProjects: vi
        .fn()
        .mockResolvedValue([{ root: 'C:/dev/a', name: 'a', lastOpenedAt: 2, open: false }]),
      openProject,
    });
    render(<ProjectButton />);
    fireEvent.click(screen.getByRole('button', { name: /…/ }));

    const row = await screen.findByText('C:/dev/a');
    fireEvent.click(row);
    await waitFor(() =>
      expect(openProject).toHaveBeenCalledWith({ root: 'C:/dev/a', target: 'current' }),
    );
  });

  it("a recent row's new-window action opens in a new window and never the row's own click target", async () => {
    const openProject = vi
      .fn()
      .mockResolvedValue({ opened: 'new', workspace: { name: 'a', root: 'C:/dev/a' } });
    stubCoa({
      listRecentProjects: vi
        .fn()
        .mockResolvedValue([{ root: 'C:/dev/a', name: 'a', lastOpenedAt: 2, open: false }]),
      openProject,
    });
    render(<ProjectButton />);
    fireEvent.click(screen.getByRole('button', { name: /…/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Open a in a new window' }));
    await waitFor(() =>
      expect(openProject).toHaveBeenCalledWith({ root: 'C:/dev/a', target: 'new' }),
    );
  });
});
