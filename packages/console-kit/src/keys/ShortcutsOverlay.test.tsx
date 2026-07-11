// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Keybind } from './Kbd.js';
import { ShortcutsOverlay } from './ShortcutsOverlay.js';

const BINDS: Keybind[] = [
  { keys: ['ctrl', 'k'], label: 'command palette', group: 'global' },
  { keys: ['esc'], label: 'dismiss the topmost layer', group: 'workbench' },
];

describe('ShortcutsOverlay', () => {
  it('renders every bind under its group with kbd chips', () => {
    render(<ShortcutsOverlay keybinds={BINDS} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('global')).toBeInTheDocument();
    expect(screen.getByText('workbench')).toBeInTheDocument();
    expect(screen.getByText('command palette')).toBeInTheDocument();
    expect(screen.getByText('ctrl')).toBeInTheDocument();
    expect(screen.getByText('k')).toBeInTheDocument();
  });
});
