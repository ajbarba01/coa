// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

describe('Composer', () => {
  it('gives the outer container a raised surface', () => {
    const { container } = render(<Composer onSend={vi.fn()} />);
    expect(container.querySelector('.bg-raised')).not.toBeNull();
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
  it('shows glyph send/stop and inert attach + mic controls', () => {
    render(<Composer onSend={() => {}} />);
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /attach/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /voice|mic/i })).toBeInTheDocument();
  });
  it('disables input and shows a hint when there is no session', () => {
    render(<Composer onSend={() => {}} disabled />);
    expect(screen.getByLabelText('Message the agent')).toBeDisabled();
  });
  it('leaves attach and mic disabled when no handler is passed', () => {
    render(<Composer onSend={vi.fn()} />);
    expect(screen.getByRole('button', { name: /attach/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /voice|mic/i })).toBeDisabled();
  });
  it('enables attach and mic once handlers are passed and calls them on click', async () => {
    const onAttach = vi.fn();
    const onMic = vi.fn();
    render(<Composer onSend={vi.fn()} onAttach={onAttach} onMic={onMic} />);
    const attachBtn = screen.getByRole('button', { name: /attach/i });
    const micBtn = screen.getByRole('button', { name: /voice|mic/i });
    expect(attachBtn).not.toBeDisabled();
    expect(micBtn).not.toBeDisabled();
    await userEvent.click(attachBtn);
    await userEvent.click(micBtn);
    expect(onAttach).toHaveBeenCalled();
    expect(onMic).toHaveBeenCalled();
  });
  it('does not show a scrollbar until content exceeds the max height', () => {
    render(<Composer onSend={vi.fn()} />);
    const box = screen.getByRole('textbox');
    expect(box.className).toMatch(/overflow-hidden/);
    expect(box.className).not.toMatch(/overflow-y-auto/);
  });
});
