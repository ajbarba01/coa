// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Plus } from 'lucide-react';
import { SwitcherMenu } from './SwitcherMenu.js';

const groups = [
  {
    id: 'pinned',
    label: 'Pinned',
    options: [{ id: 'a', label: 'reviewer', selected: true, meta: '2h' }],
  },
  {
    id: 'project',
    label: 'Project',
    options: [{ id: 'b', label: 'tdd-implementer' }],
    actions: [{ id: 'new', label: 'New agent', icon: Plus }],
  },
  { id: 'empty', label: 'Empty', options: [] },
];

describe('SwitcherMenu', () => {
  it('opens, shows labelled groups, and selects an option', async () => {
    const onSelect = vi.fn();
    render(
      <SwitcherMenu
        trigger={<button type="button">reviewer</button>}
        groups={groups}
        onSelect={onSelect}
        label="Agents"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'reviewer' }));
    expect(await screen.findByText('Pinned')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /tdd-implementer/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('fires group action rows through onAction', async () => {
    const onAction = vi.fn();
    render(
      <SwitcherMenu
        trigger={<button type="button">open</button>}
        groups={groups}
        onSelect={vi.fn()}
        onAction={onAction}
        label="Agents"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'New agent' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith('new');
  });

  it('hides empty groups and shows meta text', async () => {
    render(
      <SwitcherMenu
        trigger={<button type="button">open</button>}
        groups={groups}
        onSelect={vi.fn()}
        label="Agents"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(await screen.findByText('2h')).toBeInTheDocument();
    expect(screen.queryByText('Empty')).not.toBeInTheDocument();
  });

  it('filters options through the search box when searchable', async () => {
    render(
      <SwitcherMenu
        searchable
        trigger={<button type="button">open</button>}
        groups={groups}
        onSelect={vi.fn()}
        label="Agents"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    const search = await screen.findByRole('textbox', { name: 'Filter Agents' });
    await userEvent.type(search, 'tdd');
    expect(screen.getByRole('menuitem', { name: /tdd-implementer/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'reviewer' })).not.toBeInTheDocument();
  });

  it('deletes an option via its delete button, without selecting or closing', async () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(
      <SwitcherMenu
        trigger={<button type="button">open</button>}
        groups={groups}
        onSelect={onSelect}
        onDelete={onDelete}
        label="Sessions"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete reviewer' }));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('a');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('toggles pin from an option pin button, without selecting', async () => {
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    render(
      <SwitcherMenu
        trigger={<button type="button">open</button>}
        groups={groups}
        onSelect={onSelect}
        onTogglePin={onTogglePin}
        label="Agents"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Pin tdd-implementer' }));
    expect(onTogglePin).toHaveBeenCalledExactlyOnceWith('b');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('moves focus from the search box into the list on ArrowDown', async () => {
    render(
      <SwitcherMenu
        searchable
        trigger={<button type="button">open</button>}
        groups={groups}
        onSelect={vi.fn()}
        label="Agents"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    const search = await screen.findByRole('textbox', { name: 'Filter Agents' });
    search.focus();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
  });

  it('opens on pointer-enter (no click) when openOnHover', async () => {
    const onSelect = vi.fn();
    render(
      <SwitcherMenu
        openOnHover
        trigger={<button type="button">open</button>}
        groups={groups}
        onSelect={onSelect}
        label="Agents"
      />,
    );
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'open' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /tdd-implementer/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('b');
  });
});
