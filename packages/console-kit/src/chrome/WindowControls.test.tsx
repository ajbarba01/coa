// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WindowControls } from './WindowControls.js';

function mount(isMaximized = false): {
  onMinimize: ReturnType<typeof vi.fn>;
  onToggleMaximize: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const handlers = {
    onMinimize: vi.fn(),
    onToggleMaximize: vi.fn(),
    onClose: vi.fn(),
  };
  render(<WindowControls isMaximized={isMaximized} {...handlers} />);
  return handlers;
}

describe('WindowControls', () => {
  it('renders the three window verbs and routes each click', () => {
    const handlers = mount();
    fireEvent.click(screen.getByRole('button', { name: /^minimize$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^maximize$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(handlers.onMinimize).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleMaximize).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('flips the middle button to restore when maximized', () => {
    mount(true);
    expect(screen.getByRole('button', { name: /^restore$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^maximize$/i })).toBeNull();
  });
});
