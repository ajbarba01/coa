// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Check } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon.js';

describe('Icon', () => {
  it('is decorative (aria-hidden) by default', () => {
    const { container } = render(<Icon name={Check} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
  it('is a labelled image when given a label', () => {
    render(<Icon name={Check} label="Done" />);
    const img = screen.getByRole('img', { name: 'Done' });
    expect(img).toBeInTheDocument();
    expect(img).not.toHaveAttribute('aria-hidden');
  });
});
