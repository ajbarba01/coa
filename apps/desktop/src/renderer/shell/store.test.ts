import { beforeEach, describe, expect, it } from 'vitest';
import { useShell } from './store.js';

describe('useShell', () => {
  beforeEach(() => {
    useShell.setState(useShell.getInitialState(), true);
  });

  it('starts with the documented defaults', () => {
    const s = useShell.getState();
    expect(s.surface).toBe('chat');
    expect(s.mode).toBe('work');
    expect(s.query).toBe('');
    expect(s.tabs).toEqual([]);
    expect(s.workOpen).toBe(true);
    expect(s.navWidth).toBe(196);
    expect(s.workWidth).toBe(218);
    expect(s.settingsOpen).toBe(false);
    expect(s.shortcutsOpen).toBe(false);
    expect(s.paletteOpen).toBe(false);
    expect(s.projectOpen).toBe(false);
    expect(s.daemon).toBe('stopped');
  });

  it('openTab appends a new session id and switches to work mode', () => {
    useShell.getState().openSearch();
    useShell.getState().openTab('session-1');
    const s = useShell.getState();
    expect(s.tabs).toEqual(['session-1']);
    expect(s.mode).toBe('work');
  });

  it('openTab does not duplicate an already-open tab', () => {
    useShell.getState().openTab('session-1');
    useShell.getState().openTab('session-2');
    useShell.getState().openTab('session-1');
    expect(useShell.getState().tabs).toEqual(['session-1', 'session-2']);
  });

  it('closeTab removes a session id, leaving the others in order', () => {
    useShell.getState().openTab('session-1');
    useShell.getState().openTab('session-2');
    useShell.getState().closeTab('session-1');
    expect(useShell.getState().tabs).toEqual(['session-2']);
  });

  it('setSurface exits search mode', () => {
    useShell.getState().openSearch();
    expect(useShell.getState().mode).toBe('search');
    useShell.getState().setSurface('flags');
    const s = useShell.getState();
    expect(s.surface).toBe('flags');
    expect(s.mode).toBe('work');
  });

  it('openSearch enters search mode and clears the query', () => {
    useShell.getState().setQuery('leftover');
    useShell.getState().openSearch();
    const s = useShell.getState();
    expect(s.mode).toBe('search');
    expect(s.query).toBe('');
  });

  it('openSearch closes any open dialog — search never opens behind a modal', () => {
    useShell.getState().setSettingsOpen(true);
    useShell.getState().openSearch();
    const s = useShell.getState();
    expect(s.settingsOpen).toBe(false);
    expect(s.mode).toBe('search');
  });

  it('closeSearch clears the query and returns to work mode', () => {
    useShell.getState().openSearch();
    useShell.getState().setQuery('some query');
    useShell.getState().closeSearch();
    const s = useShell.getState();
    expect(s.mode).toBe('work');
    expect(s.query).toBe('');
  });

  it('toggleWork flips workOpen', () => {
    expect(useShell.getState().workOpen).toBe(true);
    useShell.getState().toggleWork();
    expect(useShell.getState().workOpen).toBe(false);
    useShell.getState().toggleWork();
    expect(useShell.getState().workOpen).toBe(true);
  });

  it('opens dialogs one at a time — opening one dismisses the others', () => {
    useShell.getState().setSettingsOpen(true);
    expect(useShell.getState().settingsOpen).toBe(true);
    // Opening the project dialog closes settings (never stacked).
    useShell.getState().setProjectOpen(true);
    let s = useShell.getState();
    expect(s.projectOpen).toBe(true);
    expect(s.settingsOpen).toBe(false);
    expect(s.shortcutsOpen).toBe(false);
    expect(s.paletteOpen).toBe(false);
    // Closing one leaves the rest as they were (here: all closed).
    useShell.getState().setProjectOpen(false);
    s = useShell.getState();
    expect(s.projectOpen).toBe(false);
    expect(s.settingsOpen).toBe(false);
  });

  it('setNavWidth/setWorkWidth/setDaemon set their fields directly', () => {
    useShell.getState().setNavWidth(240);
    useShell.getState().setWorkWidth(300);
    useShell.getState().setDaemon('running');
    const s = useShell.getState();
    expect(s.navWidth).toBe(240);
    expect(s.workWidth).toBe(300);
    expect(s.daemon).toBe('running');
  });
});
