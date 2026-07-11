// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StepSlider } from './StepSlider.js';

const STOPS = ['low', 'medium', 'high', 'max'] as const;

describe('StepSlider', () => {
  it('exposes the slider contract with named valuetext', () => {
    render(
      <StepSlider stops={STOPS} value="high" onChange={() => {}} aria-label="reasoning effort" />,
    );
    const el = screen.getByRole('slider', { name: 'reasoning effort' });
    expect(el).toHaveAttribute('min', '0');
    expect(el).toHaveAttribute('max', '3');
    expect(el).toHaveValue('2');
    expect(el).toHaveAttribute('aria-valuetext', 'high');
  });

  it('maps a value change back to the stop name', () => {
    const onChange = vi.fn();
    render(<StepSlider stops={STOPS} value="low" onChange={onChange} aria-label="effort" />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith('max');
  });

  it('ignores a change onto the current stop (no redundant onChange)', () => {
    const onChange = vi.fn();
    render(<StepSlider stops={STOPS} value="medium" onChange={onChange} aria-label="effort" />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a tick per stop with the filled ticks up to the value', () => {
    render(<StepSlider stops={STOPS} value="high" onChange={() => {}} aria-label="effort" />);
    const ticks = screen.getAllByTestId('step-tick');
    expect(ticks).toHaveLength(4);
    expect(ticks.filter((t) => t.className.includes('bg-s9'))).toHaveLength(3); // low..high filled
  });
});
