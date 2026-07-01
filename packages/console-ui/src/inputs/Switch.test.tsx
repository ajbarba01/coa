// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch.js';

describe('Switch', () => {
  it('renders a labelled switch and toggles', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Reduce motion" onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole('switch', { name: 'Reduce motion' });
    await userEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
