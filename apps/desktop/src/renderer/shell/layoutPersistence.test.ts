import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShell } from './store.js';
import {
  SHELL_LAYOUT_EPOCH,
  bindLayoutPersistence,
  parseShellLayout,
  serializeShellLayout,
} from './layoutPersistence.js';

const DEFAULTS = {
  epoch: SHELL_LAYOUT_EPOCH,
  surface: 'chat',
  tabs: [],
  workOpen: true,
  navWidth: 196,
  workWidth: 218,
};

describe('parseShellLayout', () => {
  it('returns the defaults for undefined', () => {
    expect(parseShellLayout(undefined)).toEqual(DEFAULTS);
  });

  it('returns the defaults for garbage input', () => {
    expect(parseShellLayout('not an object')).toEqual(DEFAULTS);
    expect(parseShellLayout(42)).toEqual(DEFAULTS);
    expect(parseShellLayout({ surface: 'chat' })).toEqual(DEFAULTS);
  });

  it('returns the defaults when the epoch does not match', () => {
    expect(
      parseShellLayout({
        epoch: SHELL_LAYOUT_EPOCH - 1,
        surface: 'flags',
        tabs: [],
        workOpen: true,
        navWidth: 200,
        workWidth: 220,
      }),
    ).toEqual(DEFAULTS);
  });

  it('parses a valid persisted layout', () => {
    const persisted = {
      epoch: SHELL_LAYOUT_EPOCH,
      surface: 'timeline',
      tabs: ['s1', 's2'],
      workOpen: false,
      navWidth: 210,
      workWidth: 260,
    };
    expect(parseShellLayout(persisted)).toEqual(persisted);
  });
});

describe('serializeShellLayout', () => {
  it('round-trips through parseShellLayout', () => {
    const layout = {
      epoch: SHELL_LAYOUT_EPOCH,
      surface: 'agents',
      tabs: ['a'],
      workOpen: false,
      navWidth: 205,
      workWidth: 230,
    };
    expect(parseShellLayout(serializeShellLayout(layout))).toEqual(layout);
  });

  it('stamps the current epoch even if given a stale one', () => {
    const stale = {
      epoch: 1 as never,
      surface: 'chat',
      tabs: [],
      workOpen: true,
      navWidth: 196,
      workWidth: 218,
    };
    expect(serializeShellLayout(stale)).toMatchObject({ epoch: SHELL_LAYOUT_EPOCH });
  });
});

describe('bindLayoutPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useShell.setState(useShell.getInitialState(), true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates the store from the bridge on bind', async () => {
    const bridge = {
      getLayout: vi.fn().mockResolvedValue({
        epoch: SHELL_LAYOUT_EPOCH,
        surface: 'flags',
        tabs: ['s1'],
        workOpen: false,
        navWidth: 250,
        workWidth: 300,
      }),
      saveLayout: vi.fn().mockResolvedValue(undefined),
    };
    const unsubscribe = await bindLayoutPersistence(bridge);
    const s = useShell.getState();
    expect(s.surface).toBe('flags');
    expect(s.tabs).toEqual(['s1']);
    expect(s.workOpen).toBe(false);
    expect(s.navWidth).toBe(250);
    expect(s.workWidth).toBe(300);
    unsubscribe();
  });

  it('degrades to defaults when the bridge layout is garbage', async () => {
    const bridge = {
      getLayout: vi.fn().mockResolvedValue('garbage'),
      saveLayout: vi.fn().mockResolvedValue(undefined),
    };
    const unsubscribe = await bindLayoutPersistence(bridge);
    expect(useShell.getState().surface).toBe('chat');
    unsubscribe();
  });

  it('saves once, debounced, after a burst of width changes', async () => {
    const bridge = {
      getLayout: vi.fn().mockResolvedValue(undefined),
      saveLayout: vi.fn().mockResolvedValue(undefined),
    };
    const unsubscribe = await bindLayoutPersistence(bridge);

    // A drag-resize burst: many rapid width changes must not write per pixel.
    for (let px = 196; px <= 250; px += 1) {
      useShell.getState().setNavWidth(px);
    }
    expect(bridge.saveLayout).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);

    expect(bridge.saveLayout).toHaveBeenCalledTimes(1);
    expect(bridge.saveLayout).toHaveBeenCalledWith(
      expect.objectContaining({ epoch: SHELL_LAYOUT_EPOCH, navWidth: 250 }),
    );
    unsubscribe();
  });

  it('does not save again once unsubscribed', async () => {
    const bridge = {
      getLayout: vi.fn().mockResolvedValue(undefined),
      saveLayout: vi.fn().mockResolvedValue(undefined),
    };
    const unsubscribe = await bindLayoutPersistence(bridge);
    useShell.getState().setNavWidth(220);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.saveLayout).not.toHaveBeenCalled();
  });

  it('does not save for a change outside the persisted subset', async () => {
    const bridge = {
      getLayout: vi.fn().mockResolvedValue(undefined),
      saveLayout: vi.fn().mockResolvedValue(undefined),
    };
    const unsubscribe = await bindLayoutPersistence(bridge);
    // settingsOpen isn't part of ShellLayout — toggling it must not schedule a write.
    useShell.getState().setSettingsOpen(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.saveLayout).not.toHaveBeenCalled();
    unsubscribe();
  });
});
