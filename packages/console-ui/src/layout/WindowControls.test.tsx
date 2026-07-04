// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WindowControls } from './WindowControls.js';

function setup(isMaximized = false): {
  onMinimize: ReturnType<typeof vi.fn>;
  onToggleMaximize: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const onMinimize = vi.fn();
  const onToggleMaximize = vi.fn();
  const onClose = vi.fn();
  render(
    <WindowControls
      isMaximized={isMaximized}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
      onClose={onClose}
    />,
  );
  return { onMinimize, onToggleMaximize, onClose };
}

describe('WindowControls', () => {
  it('renders the three caption buttons', () => {
    setup();
    expect(screen.getByLabelText('Minimize')).toBeTruthy();
    expect(screen.getByLabelText('Maximize')).toBeTruthy();
    expect(screen.getByLabelText('Close')).toBeTruthy();
  });

  it('labels the middle control Restore when maximized', () => {
    setup(true);
    expect(screen.getByLabelText('Restore')).toBeTruthy();
    expect(screen.queryByLabelText('Maximize')).toBeNull();
  });

  it('fires the matching intent for each button', () => {
    const { onMinimize, onToggleMaximize, onClose } = setup();
    fireEvent.click(screen.getByLabelText('Minimize'));
    fireEvent.click(screen.getByLabelText('Maximize'));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onMinimize).toHaveBeenCalledOnce();
    expect(onToggleMaximize).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
