// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgentRail, type AgentRailItem } from './AgentRail.js';

const items: AgentRailItem[] = [
  { id: 'a', name: 'reviewer', icon: 'search', color: 'teal', pinned: true },
  { id: 'b', name: 'tdd-implementer', icon: 'flask', color: 'blue' },
  { id: 'c', name: 'scratch-helper', icon: 'sparkles', color: 'violet' },
];

function renderRail(over: Partial<Parameters<typeof AgentRail>[0]> = {}) {
  const onSelect = vi.fn();
  const onTogglePin = vi.fn();
  const utils = render(
    <AgentRail
      items={items}
      activeId="a"
      onSelect={onSelect}
      onTogglePin={onTogglePin}
      {...over}
    />,
  );
  return { onSelect, onTogglePin, ...utils };
}

describe('AgentRail', () => {
  it('renders a labelled group with a named chip per agent', () => {
    renderRail();
    expect(screen.getByRole('group', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'reviewer' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'tdd-implementer' })).toBeInTheDocument();
  });

  it('selects an agent from the collapsed chip column', async () => {
    const { onSelect } = renderRail();
    await userEvent.click(screen.getByRole('button', { name: 'scratch-helper' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('c');
  });

  it('expands instantly on keyboard focus (no hover-intent wait)', () => {
    const { container } = renderRail();
    fireEvent.focus(screen.getByRole('button', { name: 'reviewer' }));
    expect(container.querySelector('[data-expanded="true"]')).toBeInTheDocument();
  });

  it('collapses on Escape', () => {
    const { container } = renderRail();
    const chip = screen.getByRole('button', { name: 'reviewer' });
    fireEvent.focus(chip);
    fireEvent.keyDown(chip, { key: 'Escape' });
    expect(container.querySelector('[data-expanded="false"]')).toBeInTheDocument();
  });

  it('toggles pin from the per-agent context menu', async () => {
    const { onTogglePin } = renderRail();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'reviewer' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Unpin' }));
    expect(onTogglePin).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('toggles pin from the row pin button once expanded', () => {
    const { onTogglePin } = renderRail();
    fireEvent.focus(screen.getByRole('button', { name: 'reviewer' }));
    const pin = screen.getByRole('button', { name: 'Unpin reviewer' });
    expect(pin).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pin);
    expect(onTogglePin).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('collapses after a select and stays collapsed until the pointer re-enters', () => {
    const { container, onSelect } = renderRail();
    const group = screen.getByRole('group', { name: 'Agents' });
    fireEvent.pointerEnter(group);
    expect(container.querySelector('[data-expanded="true"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tdd-implementer' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('b');
    expect(container.querySelector('[data-expanded="false"]')).toBeInTheDocument();
    // A second enter without an intervening leave must not spring it back open.
    fireEvent.pointerEnter(group);
    expect(container.querySelector('[data-expanded="false"]')).toBeInTheDocument();
    // After the pointer leaves and returns, hover reopens it.
    fireEvent.pointerLeave(group);
    fireEvent.pointerEnter(group);
    expect(container.querySelector('[data-expanded="true"]')).toBeInTheDocument();
  });

  it('offers the context menu actions per agent', async () => {
    const onNewSession = vi.fn();
    const onConfigure = vi.fn();
    renderRail({ onNewSession, onConfigure });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'tdd-implementer' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Configure' }));
    expect(onConfigure).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('roves focus with arrow keys within the focused layer', () => {
    renderRail();
    const first = screen.getByRole('button', { name: 'reviewer' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toHaveAttribute('aria-label', 'tdd-implementer');
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(document.activeElement).toHaveAttribute('aria-label', 'reviewer');
  });
});
