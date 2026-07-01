// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NavList } from './NavList.js';

describe('NavList', () => {
  it('marks the active item and reports selection', async () => {
    const onSelect = vi.fn();
    render(
      <NavList
        label="Sections"
        activeId="chat"
        onSelect={onSelect}
        items={[
          { id: 'chat', label: 'Chat' },
          { id: 'log', label: 'Decisions' },
        ]}
      />,
    );
    const active = screen.getByRole('tab', { name: 'Chat' });
    expect(active).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Decisions' }));
    expect(onSelect).toHaveBeenCalledWith('log');
  });
});
