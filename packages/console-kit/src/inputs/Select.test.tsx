// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select.js';

const OPTIONS = ['sand dark', 'sand light', 'system'] as const;

describe('Select', () => {
  it('opens on trigger, marks the current value, picks and closes', () => {
    const onChange = vi.fn();
    render(<Select options={OPTIONS} value="sand dark" onChange={onChange} aria-label="theme" />);
    fireEvent.click(screen.getByRole('combobox', { name: 'theme' }));
    expect(screen.getByText(/^current$/i)).toBeInTheDocument();
    // a real mouse selection starts on the item — Base UI ignores clicks that don't
    const option = screen.getByRole('option', { name: /system/ });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('system');
    expect(screen.queryByRole('option', { name: /system/ })).not.toBeInTheDocument();
  });

  it('Escape closes the open popup through the kit layer stack (real bubble path)', () => {
    render(<Select options={OPTIONS} value="system" onChange={() => {}} aria-label="theme" />);
    fireEvent.click(screen.getByRole('combobox', { name: 'theme' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('reflects selection state on the option rows', () => {
    render(<Select options={OPTIONS} value="sand light" onChange={() => {}} aria-label="theme" />);
    fireEvent.click(screen.getByRole('combobox', { name: 'theme' }));
    const selected = screen.getByRole('option', { name: /sand light/ });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /system/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });
});
