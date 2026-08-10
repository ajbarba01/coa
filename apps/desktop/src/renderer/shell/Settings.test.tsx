// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../panels/authStore.js';
import { makeState, resetStores, seedState } from '../testing/fixtures.js';
import {
  BrowserPathRow,
  IsolatedBrowserRow,
  ReclaimProfilesRow,
  SettingsDialog,
} from './Settings.js';
import { useShell } from './store.js';

const initialShell = useShell.getState();
const initialAuth = useAuthStore.getState();

function open(setSettings = vi.fn()): ReturnType<typeof vi.fn> {
  seedState(makeState({ actions: { setSettings } }));
  useShell.getState().setSettingsOpen(true);
  render(<SettingsDialog />);
  return setSettings;
}

beforeEach(() => {
  useShell.setState(initialShell, true);
  resetStores();
  useAuthStore.setState(initialAuth, true);
});

describe('SettingsDialog', () => {
  it('persists a motion change through the console settings action', () => {
    const setSettings = open();
    fireEvent.click(screen.getByRole('switch', { name: 'Reduce motion' }));
    expect(setSettings).toHaveBeenCalledWith({ motion: 'reduce' });
  });

  it('shows the pinned theme as a read-only value', () => {
    open();
    // Anchored: the row's description also says "sand dark", and only the value span is
    // the read-only control under test.
    expect(screen.getByText(/^sand dark$/i)).toBeTruthy();
    // No theme control to operate within appearance — one switch (motion) and nothing
    // else; the logins section carries its own switch separately.
    const appearance = document.querySelector('[data-section="appearance"]') as HTMLElement;
    expect(within(appearance).getAllByRole('switch')).toHaveLength(1);
  });

  it('search filters rows and keybinds together', () => {
    open();
    fireEvent.change(screen.getByPlaceholderText(/search settings/i), {
      target: { value: 'palette' },
    });
    expect(screen.getByText(/^command palette$/i)).toBeTruthy();
    expect(screen.queryByText('Reduce motion')).toBeNull();
  });

  it('offers no density control, because the current scale never answered to it', () => {
    open();
    expect(screen.queryByText('Density')).toBeNull();
  });

  it('renders every keybind from the registry as chips', () => {
    open();
    expect(screen.getByText(/^command palette$/i)).toBeTruthy();
    expect(screen.getByText(/^toggle the session panel$/i)).toBeTruthy();
  });
});

describe('login settings rows', () => {
  it('reflects the daemon toggle and flips it', async () => {
    const setIsolated = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({
      browserSession: { enabled: false, available: true, reclaimable: [] },
      setIsolatedBrowserLogins: setIsolated,
    });
    render(<IsolatedBrowserRow />);
    await userEvent.click(screen.getByRole('switch'));
    expect(setIsolated).toHaveBeenCalledWith(true);
  });

  /** Under identity keying an orphan can only appear when an account's email is renamed, so
   *  the ordinary state is "none" — and the row stays visible saying so, rather than hiding
   *  and leaving the concept undiscoverable (profiles share one user-data-dir; orphaned jars are reclaimed only on request). */
  it('says none when nothing is reclaimable, rather than disappearing', () => {
    useAuthStore.setState({
      browserSession: { enabled: true, available: true, reclaimable: [] },
    });
    render(<ReclaimProfilesRow />);
    expect(screen.getByText(/^none$/i)).toBeTruthy();
  });

  it('lists jars behind a review action and deletes one by name', async () => {
    const reclaim = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({
      browserSession: {
        enabled: true,
        available: true,
        reclaimable: ['ghost-a-1a2b3c', 'ghost-b-4d5e6f'],
      },
      reclaimBrowserProfiles: reclaim,
    });
    render(<ReclaimProfilesRow />);
    await userEvent.click(screen.getByText(/review 2/i));
    expect(screen.getByText('ghost-a-1a2b3c')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /remove browser profile ghost-a/i }));
    expect(reclaim).toHaveBeenCalledWith(['ghost-a-1a2b3c']);
  });

  it('offers one action for the whole list', async () => {
    const reclaim = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({
      browserSession: { enabled: true, available: true, reclaimable: ['a-1a2b3c', 'b-4d5e6f'] },
      reclaimBrowserProfiles: reclaim,
    });
    render(<ReclaimProfilesRow />);
    await userEvent.click(screen.getByText(/review 2/i));
    await userEvent.click(screen.getByText(/^remove all$/i));
    expect(reclaim).toHaveBeenCalledWith(['a-1a2b3c', 'b-4d5e6f']);
  });

  it('says so when no browser was found instead of hiding the control', () => {
    useAuthStore.setState({ browserSession: { enabled: true, available: false, reclaimable: [] } });
    render(<IsolatedBrowserRow />);
    expect(screen.getByText(/no browser found/i)).toBeTruthy();
    expect(screen.getByRole('switch')).toBeTruthy();
  });

  it('prefills the override from detection and commits an edit', async () => {
    const setPath = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({
      browserSession: {
        enabled: true,
        available: true,
        detectedPath: 'C:\\chrome.exe',
        reclaimable: [],
      },
      setBrowserPath: setPath,
    });
    render(<BrowserPathRow />);
    const field = screen.getByLabelText('Browser');
    expect((field as HTMLInputElement).value).toBe('C:\\chrome.exe');
    await userEvent.clear(field);
    await userEvent.type(field, 'D:\\brave.exe{Enter}');
    expect(setPath).toHaveBeenCalledWith('D:\\brave.exe');
  });

  it('does not pin auto-detection as an override when Enter is pressed without editing', async () => {
    const setPath = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({
      browserSession: {
        enabled: true,
        available: true,
        detectedPath: 'C:\\chrome.exe',
        reclaimable: [],
      },
      setBrowserPath: setPath,
    });
    render(<BrowserPathRow />);
    const field = screen.getByLabelText('Browser');
    field.focus();
    await userEvent.keyboard('{Enter}');
    expect(setPath).not.toHaveBeenCalled();
  });

  it('does not clear a stored override when it mounts alone against an unhydrated store', async () => {
    // Reproduces the search-filtered case: BrowserPathRow is the only row a query left
    // mounted, so it never sees the daemon's real answer — a blank field must not read as
    // "the user wants no override" and blindly commit that over what the daemon has.
    const setPath = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ setBrowserPath: setPath });
    render(<BrowserPathRow />);
    const field = screen.getByLabelText('Browser');
    expect((field as HTMLInputElement).value).toBe('');
    field.focus();
    await userEvent.keyboard('{Enter}');
    expect(setPath).not.toHaveBeenCalled();
  });

  it('no longer hydrates from IsolatedBrowserRow — that is the dialog\u2019s job now', async () => {
    // A row-owned hydrate breaks the moment a search query filters that row out of the
    // mounted tree; the dialog is the one thing guaranteed present regardless of the
    // query, so it is the one that must own the read (profile cleanup only ever happens at the user's explicit request).
    const hydrate = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ hydrate });
    render(<IsolatedBrowserRow />);
    await new Promise((r) => setTimeout(r, 0));
    expect(hydrate).not.toHaveBeenCalled();
  });

  it('hydrates the browser session from the dialog itself on open', async () => {
    const hydrate = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ hydrate });
    useShell.getState().setSettingsOpen(false);
    seedState(makeState({ actions: { setSettings: vi.fn() } }));
    render(<SettingsDialog />);
    expect(hydrate).not.toHaveBeenCalled();

    useShell.getState().setSettingsOpen(true);
    await waitFor(() => expect(hydrate).toHaveBeenCalled());
  });
});
