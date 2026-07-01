// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Divider } from './Divider.js';

describe('Divider', () => {
  it('is a horizontal separator by default', () => {
    render(<Divider />);
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-orientation', 'horizontal');
  });
  it('can be vertical', () => {
    render(<Divider orientation="vertical" />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });
});
