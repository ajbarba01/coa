// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField.js';

describe('TextField', () => {
  it('renders a labelled text input and accepts typing', async () => {
    render(<TextField label="Project" />);
    const input = screen.getByRole('textbox', { name: 'Project' });
    await userEvent.type(input, 'coa');
    expect(input).toHaveValue('coa');
  });

  it('marks itself invalid and shows the error', () => {
    render(<TextField label="Project" error="Too short" />);
    const input = screen.getByRole('textbox', { name: 'Project' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('data-invalid', 'true');
    expect(screen.getByText('Too short')).toBeInTheDocument();
  });

  it('disables the input', () => {
    render(<TextField label="Project" disabled />);
    expect(screen.getByRole('textbox', { name: 'Project' })).toBeDisabled();
  });
});
