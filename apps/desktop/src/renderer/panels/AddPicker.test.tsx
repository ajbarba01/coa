// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddPicker, type AddPickerItem } from './AddPicker.js';

const ITEMS: AddPickerItem[] = [
  { id: 'core', name: 'Core', membership: 'inherited' },
  { id: 'coding', name: 'Coding', membership: 'available' },
  { id: 'research', name: 'Research', membership: 'available' },
];

describe('AddPicker', () => {
  it('stays open across selections so adding several is one visit', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <AddPicker label="Add Context" items={ITEMS} onToggle={onToggle} placeholder="Filter…" />,
    );
    await user.click(screen.getByRole('button', { name: 'Add Context' }));
    await user.click(screen.getByRole('checkbox', { name: 'Coding' }));
    await user.click(screen.getByRole('checkbox', { name: 'Research' }));
    expect(onToggle).toHaveBeenNthCalledWith(1, 'coding');
    expect(onToggle).toHaveBeenNthCalledWith(2, 'research');
    expect(screen.getByPlaceholderText('Filter…')).toBeInTheDocument();
  });

  it('filters its rows as you type', async () => {
    const user = userEvent.setup();
    render(
      <AddPicker label="Add Context" items={ITEMS} onToggle={() => {}} placeholder="Filter…" />,
    );
    await user.click(screen.getByRole('button', { name: 'Add Context' }));
    await user.type(screen.getByPlaceholderText('Filter…'), 'res');
    expect(screen.getByRole('checkbox', { name: 'Research' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Coding' })).not.toBeInTheDocument();
  });

  it('mirrors what is already in, so the registry never lies about state', async () => {
    const user = userEvent.setup();
    render(
      <AddPicker label="Add Context" items={ITEMS} onToggle={() => {}} placeholder="Filter…" />,
    );
    await user.click(screen.getByRole('button', { name: 'Add Context' }));
    expect(screen.getByRole('checkbox', { name: 'Core' })).toHaveAttribute('aria-checked', 'mixed');
  });

  it('moves the cursor with the arrow keys and toggles the row it lands on with enter', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <AddPicker label="Add Context" items={ITEMS} onToggle={onToggle} placeholder="Filter…" />,
    );
    await user.click(screen.getByRole('button', { name: 'Add Context' }));
    // Two steps down from the first row (Core) lands on the third and last row,
    // Research — the same "land on the far row" shape as the kit Combobox's own
    // arrow test, so a no-op ArrowDown (cursor stuck at 0) would toggle Core instead
    // and a wrap-around bug would land back on Core too, not silently pass either way.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('research');
  });

  it('toggles the Tab-focused row on Enter, not whatever the mouse last hovered', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <AddPicker label="Add Context" items={ITEMS} onToggle={onToggle} placeholder="Filter…" />,
    );
    await user.click(screen.getByRole('button', { name: 'Add Context' }));
    // Tab past the input to the third row (Research) — a real DOM focus move, not a
    // mouse hover, so the cursor (mouse-only until now) must follow it.
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Research' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('research');
  });

  it('Space still toggles the Tab-focused row, agreeing with Enter', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <AddPicker label="Add Context" items={ITEMS} onToggle={onToggle} placeholder="Filter…" />,
    );
    await user.click(screen.getByRole('button', { name: 'Add Context' }));
    await user.tab();
    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Coding' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('coding');
  });

  it('closes on escape', async () => {
    const user = userEvent.setup();
    render(
      <AddPicker label="Add Context" items={ITEMS} onToggle={() => {}} placeholder="Filter…" />,
    );
    await user.click(screen.getByRole('button', { name: 'Add Context' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByPlaceholderText('Filter…')).not.toBeInTheDocument();
  });
});
