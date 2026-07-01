// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select.js';

const options = [
  { value: 'pro', label: 'Pro' },
  { value: 'max', label: 'Max' },
];

describe('Select', () => {
  it('opens and selects an option', async () => {
    const onValueChange = vi.fn();
    render(
      <Select label="Plan" options={options} placeholder="Choose" onValueChange={onValueChange} />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Plan' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Max' }));
    expect(onValueChange).toHaveBeenCalledWith('max');
  });
});
