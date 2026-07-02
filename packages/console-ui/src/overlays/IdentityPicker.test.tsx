// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IdentityPicker } from './IdentityPicker.js';

describe('IdentityPicker', () => {
  it('opens from the chip trigger and picks an icon and a color', async () => {
    const onIconChange = vi.fn();
    const onColorChange = vi.fn();
    render(
      <IdentityPicker
        icon="bot"
        color="slate"
        onIconChange={onIconChange}
        onColorChange={onColorChange}
        label="reviewer"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'reviewer — change icon and color' }));
    await userEvent.click(await screen.findByRole('button', { name: 'wrench' }));
    expect(onIconChange).toHaveBeenCalledWith('wrench');
    await userEvent.click(screen.getByRole('button', { name: 'teal' }));
    expect(onColorChange).toHaveBeenCalledWith('teal');
  });

  it('marks the current icon and color as pressed', async () => {
    render(
      <IdentityPicker
        icon="search"
        color="sky"
        onIconChange={vi.fn()}
        onColorChange={vi.fn()}
        label="reviewer"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /change icon and color/ }));
    expect(await screen.findByRole('button', { name: 'search' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'sky' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'teal' })).toHaveAttribute('aria-pressed', 'false');
  });
});
