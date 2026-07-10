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
  it('shows Queue, Steer, and a Stop control while running', () => {
    render(<Composer onSend={vi.fn()} running onSteer={vi.fn()} onInterrupt={vi.fn()} />);
    expect(screen.getByRole('button', { name: /queue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /steer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    // The old ambiguous "Interrupt" action is gone — Stop is a dedicated always-on control.
    expect(screen.queryByRole('button', { name: /interrupt/i })).not.toBeInTheDocument();
  });
  it('disables Queue and Steer with an empty box, and enables them once you type', async () => {
    render(<Composer onSend={vi.fn()} running onSteer={vi.fn()} onInterrupt={vi.fn()} />);
    expect(screen.getByRole('button', { name: /queue/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /steer/i })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'do this next');
    expect(screen.getByRole('button', { name: /queue/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /steer/i })).not.toBeDisabled();
  });
  it('keeps Stop enabled with an empty box and calls onInterrupt (a clean stop, never a blank steer)', async () => {
    const onSteer = vi.fn();
    const onInterrupt = vi.fn();
    render(<Composer onSend={vi.fn()} running onSteer={onSteer} onInterrupt={onInterrupt} />);
    const stop = screen.getByRole('button', { name: /stop/i });
    expect(stop).not.toBeDisabled();
    await userEvent.click(stop);
    expect(onInterrupt).toHaveBeenCalled();
    expect(onSteer).not.toHaveBeenCalled();
  });
  it('calls onInterrupt on Escape while running', async () => {
    const onInterrupt = vi.fn();
    render(<Composer onSend={vi.fn()} running onSteer={vi.fn()} onInterrupt={onInterrupt} />);
    await userEvent.type(screen.getByRole('textbox'), '{Escape}');
    expect(onInterrupt).toHaveBeenCalled();
  });
  it('Enter while running steers (barge-in) with the typed message and clears', async () => {
    const onSteer = vi.fn();
    render(<Composer onSend={vi.fn()} running onSteer={onSteer} onInterrupt={vi.fn()} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'go left instead{Enter}');
    expect(onSteer).toHaveBeenCalledWith('go left instead', 'barge-in');
    expect(box).toHaveValue('');
  });
  it('Enter while running with an empty box does nothing (Stop is the dedicated stop)', async () => {
    const onSteer = vi.fn();
    const onInterrupt = vi.fn();
    render(<Composer onSend={vi.fn()} running onSteer={onSteer} onInterrupt={onInterrupt} />);
    await userEvent.type(screen.getByRole('textbox'), '{Enter}');
    expect(onSteer).not.toHaveBeenCalled();
    expect(onInterrupt).not.toHaveBeenCalled();
  });
  it('the Steer button barges in with the typed message and clears', async () => {
    const onSteer = vi.fn();
    render(<Composer onSend={vi.fn()} running onSteer={onSteer} onInterrupt={vi.fn()} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'redirect now');
    await userEvent.click(screen.getByRole('button', { name: /steer/i }));
    expect(onSteer).toHaveBeenCalledWith('redirect now', 'barge-in');
    expect(box).toHaveValue('');
  });
  it('the Queue button queues the typed message and clears', async () => {
    const onSteer = vi.fn();
    render(<Composer onSend={vi.fn()} running onSteer={onSteer} onInterrupt={vi.fn()} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'also add tests');
    await userEvent.click(screen.getByRole('button', { name: /queue/i }));
    expect(onSteer).toHaveBeenCalledWith('also add tests', 'queue');
    expect(box).toHaveValue('');
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
