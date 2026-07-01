// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox.js';

describe('Checkbox', () => {
  it('renders a labelled checkbox and toggles', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Verbose" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox', { name: 'Verbose' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
  it('disables', () => {
    render(<Checkbox label="Verbose" disabled />);
    expect(screen.getByRole('checkbox', { name: 'Verbose' })).toBeDisabled();
  });
});
