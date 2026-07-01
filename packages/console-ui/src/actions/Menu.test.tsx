// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Menu } from './Menu.js';

describe('Menu', () => {
  it('opens on trigger and selects an item', async () => {
    const onSelect = vi.fn();
    render(
      <Menu
        trigger={<button type="button">More</button>}
        items={[
          { id: 'a', label: 'Rewind', onSelect },
          { id: 'b', label: 'Copy' },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const item = await screen.findByRole('menuitem', { name: 'Rewind' });
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
