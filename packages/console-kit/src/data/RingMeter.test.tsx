// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RingMeter } from './RingMeter.js';

describe('RingMeter', () => {
  it('announces as a meter with its clamped value', () => {
    render(<RingMeter percent={140} aria-label="Context used" />);
    const meter = screen.getByRole('meter', { name: 'Context used' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
  });

  it('earns its stroke tone from the value (ground → amber → red)', () => {
    const { container, rerender } = render(<RingMeter percent={10} />);
    const fill = (): Element | null => container.querySelector('circle:nth-of-type(2)');
    expect(fill()?.getAttribute('class')).toContain('text-s8');
    rerender(<RingMeter percent={60} />);
    expect(fill()?.getAttribute('class')).toContain('text-warn');
    rerender(<RingMeter percent={90} />);
    expect(fill()?.getAttribute('class')).toContain('text-crit');
  });

  it('honors a caller-earned tone override (callers with their own ramp)', () => {
    const { container } = render(<RingMeter percent={10} tone="critical" />);
    expect(container.querySelector('circle:nth-of-type(2)')?.getAttribute('class')).toContain(
      'text-crit',
    );
  });

  it('renders the honest unknown: dashed track, no fill, no meter role', () => {
    const { container } = render(<RingMeter aria-label="Context window unknown" />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Context window unknown' })).toBeInTheDocument();
    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(1);
    expect(circles[0]?.getAttribute('stroke-dasharray')).toBe('2 2');
  });

  it('draws a minimum visible tick for a tiny non-zero value, and none at exactly zero', () => {
    const { container, rerender } = render(<RingMeter percent={0.01} size={14} />);
    const dash = (): string =>
      container.querySelector('circle:nth-of-type(2)')?.getAttribute('stroke-dasharray') ?? '';
    expect(Number.parseFloat(dash())).toBeGreaterThanOrEqual(1.5);
    rerender(<RingMeter percent={0} size={14} />);
    expect(Number.parseFloat(dash())).toBe(0);
  });
});
