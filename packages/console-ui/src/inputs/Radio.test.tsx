// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Radio } from './Radio.js';

describe('Radio', () => {
  it('renders a labelled radiogroup and selects a value', async () => {
    const onValueChange = vi.fn();
    render(
      <Radio
        label="Mode"
        options={[
          { value: 'a', label: 'Attended' },
          { value: 'u', label: 'Unattended' },
        ]}
        onValueChange={onValueChange}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Unattended' }));
    expect(onValueChange).toHaveBeenCalledWith('u');
  });
});
