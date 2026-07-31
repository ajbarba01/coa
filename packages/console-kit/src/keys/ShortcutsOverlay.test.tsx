// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Keybind } from './Kbd.js';
import { filterKeybinds, ShortcutsOverlay, type KeybindEditing } from './ShortcutsOverlay.js';

const BINDS: Keybind[] = [
  { id: 'palette', keys: ['ctrl', 'k'], label: 'command palette', group: 'global' },
  { id: 'close-tab', keys: ['ctrl', 'w'], label: 'close tab', group: 'sessions' },
  {
    id: 'dismiss',
    keys: ['esc'],
    label: 'dismiss the topmost layer',
    group: 'workbench',
    fixed: true,
  },
];

/** A stand-in for the app's vocabulary: ctrl-carried chords only, and `ctrl+w` is taken. */
function editingStub(over: Partial<KeybindEditing> = {}): KeybindEditing {
  return {
    chordFromEvent: (e) =>
      e.key === 'Control' ? undefined : e.ctrlKey ? ['ctrl', e.key] : [e.key],
    isBindable: (keys) => keys.includes('ctrl'),
    conflictLabel: (id, keys) =>
      keys.join('+') === 'ctrl+w' && id !== 'close-tab' ? 'close tab' : undefined,
    onRebind: vi.fn(),
    onReset: vi.fn(),
    onResetAll: vi.fn(),
    isCustom: () => false,
    ...over,
  };
}

describe('filterKeybinds', () => {
  it('matches on the label and on the chord, so “close” and “ctrl w” find the same row', () => {
    expect(filterKeybinds(BINDS, 'close').map((k) => k.id)).toEqual(['close-tab']);
    expect(filterKeybinds(BINDS, 'ctrl w').map((k) => k.id)).toEqual(['close-tab']);
    expect(filterKeybinds(BINDS, '')).toHaveLength(3);
    expect(filterKeybinds(BINDS, 'nothing')).toHaveLength(0);
  });
});

describe('ShortcutsOverlay', () => {
  it('renders every bind under its group with kbd chips', () => {
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('global')).toBeInTheDocument();
    expect(screen.getByText('workbench')).toBeInTheDocument();
    expect(screen.getByText('command palette')).toBeInTheDocument();
    expect(screen.getByText('k')).toBeInTheDocument();
  });

  /** Label-adjacency law (UI.md): an icon-ONLY control carries a drawn mark. */
  it('draws its close mark rather than typing one', () => {
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} />);
    const close = screen.getByRole('button', { name: 'close shortcuts' });
    expect(close.querySelector('svg')).not.toBeNull();
    expect(close.textContent).toBe('');
  });

  it('offers no editing affordances without an editing seam (the read-only reference)', () => {
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /rebind/ })).toBeNull();
  });

  it('makes the chord itself the control — the row it records is the row you clicked', () => {
    const editing = editingStub();
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} editing={editing} />);
    // The clickable control IS the chord: its chips are inside it, so there is nothing to
    // learn beyond "click the keys to change the keys".
    const field = screen.getByRole('button', { name: 'rebind command palette' });
    expect(field).toHaveTextContent('ctrl');
    expect(field).toHaveTextContent('k');

    fireEvent.click(field);
    expect(field).toHaveTextContent('listening…');
    fireEvent.keyDown(field, { key: 'j', ctrlKey: true });
    expect(field).toHaveTextContent('j'); // the captured chord shows in the field itself
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(editing.onRebind).toHaveBeenCalledExactlyOnceWith('palette', ['ctrl', 'j']);
  });

  it('focuses the filter on open — finding a shortcut is why the card was summoned', () => {
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText('filter shortcuts'));
  });

  it('filters the rows as the user types', () => {
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('filter shortcuts'), { target: { value: 'close' } });
    expect(screen.getByText('close tab')).toBeInTheDocument();
    expect(screen.queryByText('command palette')).toBeNull();
  });

  it('captures a chord and applies it only on Enter', () => {
    const editing = editingStub();
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} editing={editing} />);
    const record = screen.getByRole('button', { name: 'rebind command palette' });

    fireEvent.click(record);
    fireEvent.keyDown(record, { key: 'j', ctrlKey: true });
    // shown, NOT applied — the chord is a proposal until it's confirmed
    expect(editing.onRebind).not.toHaveBeenCalled();
    expect(screen.getByText('enter to apply · esc to cancel')).toBeInTheDocument();

    fireEvent.keyDown(record, { key: 'Enter' });
    expect(editing.onRebind).toHaveBeenCalledExactlyOnceWith('palette', ['ctrl', 'j']);
  });

  it('warns whose bind a chord would take BEFORE it is applied', () => {
    const editing = editingStub();
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} editing={editing} />);
    const record = screen.getByRole('button', { name: 'rebind command palette' });

    fireEvent.click(record);
    fireEvent.keyDown(record, { key: 'w', ctrlKey: true });
    expect(screen.getByText('close tab holds this — enter to reassign it')).toBeInTheDocument();
    expect(editing.onRebind).not.toHaveBeenCalled();

    fireEvent.keyDown(record, { key: 'Enter' });
    expect(editing.onRebind).toHaveBeenCalledExactlyOnceWith('palette', ['ctrl', 'w']);
  });

  it('refuses a chord that cannot carry a binding, and Escape cancels the recording', () => {
    const editing = editingStub();
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} editing={editing} />);
    const record = screen.getByRole('button', { name: 'rebind command palette' });

    fireEvent.click(record);
    fireEvent.keyDown(record, { key: 'j' }); // no modifier
    expect(screen.getByText('needs ctrl or alt')).toBeInTheDocument();

    fireEvent.keyDown(record, { key: 'Escape' });
    expect(screen.queryByText('needs ctrl or alt')).toBeNull();
    expect(editing.onRebind).not.toHaveBeenCalled();
  });

  it('never offers to rebind a fixed row', () => {
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} editing={editingStub()} />);
    expect(screen.queryByRole('button', { name: /rebind dismiss/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'rebind close tab' })).toBeInTheDocument();
  });

  it('shows an unbound command as unbound rather than as having no shortcut', () => {
    const binds: Keybind[] = [
      { id: 'palette', keys: [], label: 'command palette', group: 'global' },
    ];
    render(<ShortcutsOverlay keybinds={binds} onClose={() => {}} editing={editingStub()} />);
    expect(screen.getByText('unbound')).toBeInTheDocument();
  });

  it('offers a reset only for a bind the user has customised', () => {
    const editing = editingStub({ isCustom: (id) => id === 'close-tab' });
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} editing={editing} />);
    expect(screen.queryByRole('button', { name: 'reset command palette' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'reset close tab' }));
    expect(editing.onReset).toHaveBeenCalledExactlyOnceWith('close-tab');
  });
});
