// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReasoningChip } from './ReasoningPicker.js';

const EFFORTS = [
  { value: 'none', label: 'No thinking' },
  { value: 'think', label: 'think' },
  { value: 'ultra', label: 'ultra' },
];

describe('ReasoningChip', () => {
  it('names the current stop on the trigger', () => {
    render(<ReasoningChip options={EFFORTS} value="think" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Reasoning' })).toHaveTextContent('think');
  });

  it('keeps the ladder in the popup until it is opened, then reports a moved stop', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ReasoningChip options={EFFORTS} value="think" onChange={onChange} />);
    expect(screen.queryByRole('slider', { name: 'Reasoning effort' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reasoning' }));
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('ultra');
  });

  it('titles the popup, since a bare ladder names only its own stops', async () => {
    const user = userEvent.setup();
    render(<ReasoningChip options={EFFORTS} value="think" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Reasoning' }));
    expect(screen.getByText('Reasoning effort')).toBeInTheDocument();
  });

  it('pads the popup evenly — it is a card in its own right, not a footer under a hairline', async () => {
    const user = userEvent.setup();
    const { baseElement } = render(
      <ReasoningChip options={EFFORTS} value="think" onChange={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Reasoning' }));
    const surface = baseElement.querySelector('[class*="rounded-r3"]');
    // The shared menu surface carries its own py-1, which a caller's p-0 does NOT beat
    // (both are emitted and the cascade settles it by value). Flush drops it instead, so
    // the padding you can see is the one this component actually wrote.
    expect(surface?.className).not.toContain('py-1');
  });

  it('renders nothing for a model with no ladder to offer', () => {
    render(<ReasoningChip options={[]} value="" onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Reasoning' })).toBeNull();
  });

  it('rests disabled with no session, and will not open', async () => {
    const user = userEvent.setup();
    render(<ReasoningChip options={EFFORTS} value="think" onChange={vi.fn()} disabled />);
    const trigger = screen.getByRole('button', { name: 'Reasoning' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('slider', { name: 'Reasoning effort' })).toBeNull();
  });
});
