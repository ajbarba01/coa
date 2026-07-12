// @vitest-environment jsdom
import type { Keybind } from '@coa/console-kit';
import { describe, expect, it } from 'vitest';
import {
  canonical,
  chordFromEvent,
  commandFor,
  conflictFor,
  DEFAULT_KEYBINDS,
  effectiveKeybinds,
  isBindable,
  jumpTarget,
  rebind,
  scopeOf,
} from './keybinds.js';

const ev = (init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  new KeyboardEvent('keydown', init);

const BINDS: Keybind[] = [
  { id: 'palette', keys: ['ctrl', 'k'], label: 'command palette', group: 'global' },
  { id: 'search', keys: ['ctrl', 'p'], label: 'search sessions', group: 'global' },
  { id: 'dismiss', keys: ['esc'], label: 'dismiss', group: 'workbench', fixed: true },
];

describe('chordFromEvent', () => {
  it('names the chord a key event carries, folding cmd into ctrl', () => {
    expect(chordFromEvent(ev({ key: 'k', ctrlKey: true }))).toEqual(['ctrl', 'k']);
    expect(chordFromEvent(ev({ key: 'k', metaKey: true }))).toEqual(['ctrl', 'k']);
    expect(chordFromEvent(ev({ key: 'T', ctrlKey: true, shiftKey: true }))).toEqual([
      'ctrl',
      'shift',
      't',
    ]);
    expect(chordFromEvent(ev({ key: 'Tab', ctrlKey: true }))).toEqual(['ctrl', 'tab']);
    expect(chordFromEvent(ev({ key: 'Escape' }))).toEqual(['esc']);
  });

  it('names no chord while only a modifier is down', () => {
    expect(chordFromEvent(ev({ key: 'Control', ctrlKey: true }))).toBeUndefined();
    expect(chordFromEvent(ev({ key: 'Shift', shiftKey: true }))).toBeUndefined();
  });
});

describe('canonical', () => {
  it('is order- and case-insensitive over the modifiers, so two spellings of one chord match', () => {
    expect(canonical(['shift', 'ctrl', 'T'])).toBe(canonical(['ctrl', 'shift', 't']));
    expect(canonical(['ctrl', 'k'])).not.toBe(canonical(['ctrl', 'shift', 'k']));
  });
});

describe('isBindable', () => {
  it('requires a carrying modifier — a bare key would swallow typing', () => {
    expect(isBindable(['ctrl', 'k'])).toBe(true);
    expect(isBindable(['alt', 'k'])).toBe(true);
    expect(isBindable(['k'])).toBe(false);
    expect(isBindable(['shift', 'k'])).toBe(false); // shift+a is just `A`
    expect(isBindable(['ctrl'])).toBe(false); // a modifier alone is not a chord
  });
});

describe('effectiveKeybinds', () => {
  it('lays the user’s overrides over the defaults', () => {
    const binds = effectiveKeybinds(BINDS, { palette: ['ctrl', 'j'] });
    expect(binds.find((b) => b.id === 'palette')?.keys).toEqual(['ctrl', 'j']);
    expect(binds.find((b) => b.id === 'search')?.keys).toEqual(['ctrl', 'p']);
  });

  it('ignores an override of a fixed bind or of a command that no longer exists', () => {
    const binds = effectiveKeybinds(BINDS, { dismiss: ['ctrl', 'q'], ghost: ['ctrl', 'z'] });
    expect(binds.find((b) => b.id === 'dismiss')?.keys).toEqual(['esc']);
    expect(binds).toHaveLength(BINDS.length);
  });
});

describe('conflictFor / rebind', () => {
  it('names the command a chord would steal, ignoring the command’s own chord', () => {
    expect(conflictFor(BINDS, ['ctrl', 'p'], 'palette')?.id).toBe('search');
    expect(conflictFor(BINDS, ['ctrl', 'k'], 'palette')).toBeUndefined(); // its own
    expect(conflictFor(BINDS, ['ctrl', 'j'], 'palette')).toBeUndefined(); // free
  });

  it('moves the chord and leaves the loser unbound rather than fighting over the key', () => {
    const next = rebind(BINDS, {}, 'palette', ['ctrl', 'p']);
    expect(next['palette']).toEqual(['ctrl', 'p']);
    expect(next['search']).toEqual([]);

    const binds = effectiveKeybinds(BINDS, next);
    expect(commandFor(binds, ['ctrl', 'p'])).toBe('palette'); // one command answers, not two
  });
});

describe('commandFor', () => {
  it('dispatches by chord, and an unbound command answers to nothing', () => {
    const binds = effectiveKeybinds(BINDS, { search: [] });
    expect(commandFor(binds, ['ctrl', 'k'])).toBe('palette');
    expect(commandFor(binds, ['ctrl', 'p'])).toBeUndefined();
    expect(commandFor(binds, [])).toBeUndefined();
  });

  it('a scoped command is not a command outside its scope — it never acts at a distance', () => {
    const binds: Keybind[] = [
      {
        id: 'close-tab',
        keys: ['ctrl', 'w'],
        label: 'close tab',
        group: 'sessions',
        scope: 'chat',
      },
    ];
    expect(commandFor(binds, ['ctrl', 'w'], 'chat')).toBe('close-tab');
    // on another surface the chord simply isn't bound to anything — no silent close
    expect(commandFor(binds, ['ctrl', 'w'], undefined)).toBeUndefined();
  });
});

describe('scopeOf', () => {
  const shell = {
    surface: 'chat',
    mode: 'work' as const,
    settingsOpen: false,
    shortcutsOpen: false,
    paletteOpen: false,
    projectOpen: false,
    newSessionOpen: false,
  };

  it('is chat only while the chat surface is the thing you are looking at', () => {
    expect(scopeOf(shell)).toBe('chat');
    expect(scopeOf({ ...shell, surface: 'agents' })).toBeUndefined();
    expect(scopeOf({ ...shell, mode: 'search' })).toBeUndefined();
    expect(scopeOf({ ...shell, paletteOpen: true })).toBeUndefined();
    expect(scopeOf({ ...shell, newSessionOpen: true })).toBeUndefined();
  });
});

describe('jumpTarget', () => {
  it('names a tab by position, with 9 meaning the last one however many are open', () => {
    expect(jumpTarget(['ctrl', '1'], 5)).toBe(0);
    expect(jumpTarget(['ctrl', '3'], 5)).toBe(2);
    expect(jumpTarget(['ctrl', '9'], 5)).toBe(4); // last, not the ninth
    expect(jumpTarget(['ctrl', '9'], 12)).toBe(11);
  });

  it('names nothing past the end, with no tabs, or when it isn’t a jump chord', () => {
    expect(jumpTarget(['ctrl', '4'], 2)).toBeUndefined();
    expect(jumpTarget(['ctrl', '1'], 0)).toBeUndefined();
    expect(jumpTarget(['ctrl', 'shift', '1'], 5)).toBeUndefined();
    expect(jumpTarget(['ctrl', 'k'], 5)).toBeUndefined();
  });
});

describe('DEFAULT_KEYBINDS', () => {
  it('has a unique id per command and no two commands share a chord', () => {
    const ids = DEFAULT_KEYBINDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const chords = DEFAULT_KEYBINDS.filter((b) => b.fixed !== true).map((b) => canonical(b.keys));
    expect(new Set(chords).size).toBe(chords.length);
  });
});
