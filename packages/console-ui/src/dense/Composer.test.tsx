// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

describe('Composer', () => {
  it('gives the outer container a raised surface', () => {
    const { container } = render(<Composer onSend={vi.fn()} />);
    expect(container.firstElementChild).toHaveClass('bg-raised');
  });
  it('sends on Enter and clears', async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'hello{Enter}');
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(box).toHaveValue('');
  });
  it('inserts a newline on Shift+Enter without sending', async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    await userEvent.type(screen.getByRole('textbox'), 'a{Shift>}{Enter}{/Shift}b');
    expect(onSend).not.toHaveBeenCalled();
  });
  it('shows Stop while running and calls onInterrupt on Escape', async () => {
    const onInterrupt = vi.fn();
    render(<Composer onSend={vi.fn()} running onInterrupt={onInterrupt} />);
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), '{Escape}');
    expect(onInterrupt).toHaveBeenCalled();
  });
});
