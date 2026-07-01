// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Combobox } from './Combobox.js';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'g', label: 'Gamma' },
];

describe('Combobox', () => {
  it('filters options by typed text and selects one', async () => {
    const onValueChange = vi.fn();
    render(<Combobox label="Symbol" options={options} onValueChange={onValueChange} />);
    const input = screen.getByRole('combobox', { name: 'Symbol' });
    await userEvent.type(input, 'be');
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Alpha' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(input).toHaveValue('Beta');
  });

  it('sets aria-expanded when options are open', async () => {
    render(<Combobox label="Symbol" options={options} />);
    const input = screen.getByRole('combobox', { name: 'Symbol' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });
});
