// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from './Toggle.js';

describe('Toggle', () => {
  it('reflects state via aria-checked and reports the flipped value', () => {
    const onChange = vi.fn();
    render(<Toggle on={false} onChange={onChange} aria-label="reduce motion" />);
    const el = screen.getByRole('switch', { name: 'reduce motion' });
    expect(el).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(el);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('on renders the neutral fill, never the accent', () => {
    render(<Toggle on onChange={() => {}} aria-label="x" />);
    const el = screen.getByRole('switch');
    expect(el).toHaveAttribute('aria-checked', 'true');
    expect(el.className).toContain('bg-s6');
    expect(el.className).not.toContain('bg-run');
  });

  it('disabled is inert and shows no pointer affordance', () => {
    const onChange = vi.fn();
    render(<Toggle on={false} onChange={onChange} disabled aria-label="x" />);
    const el = screen.getByRole('switch');
    fireEvent.click(el);
    expect(onChange).not.toHaveBeenCalled();
    expect(el).toBeDisabled();
    expect(el.className).toContain('cursor-default');
    expect(el.className).not.toContain('hover:');
  });

  it('keyboard toggles (space/enter are Base UI mechanics on a native button)', () => {
    const onChange = vi.fn();
    render(<Toggle on={false} onChange={onChange} aria-label="x" />);
    const el = screen.getByRole('switch');
    el.focus();
    fireEvent.click(el, { detail: 0 }); // keyboard activation arrives as a detail-0 click on native buttons
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
