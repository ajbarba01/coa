// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast.js';

function show(props: Partial<React.ComponentProps<typeof Toast>> = {}): void {
  render(
    <Toast open title="Couldn't open" onOpenChange={() => {}} {...props}>
      {props.children ?? 'no such file'}
    </Toast>,
  );
}

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('announces politely, so it is heard without stealing focus', () => {
    show();
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText("Couldn't open")).toBeTruthy();
    expect(screen.getByText('no such file')).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    render(<Toast open={false} title="hidden" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('dismisses on a click anywhere, not only on the close control', () => {
    const onOpenChange = vi.fn();
    show({ onOpenChange });
    screen.getByRole('status').click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('auto-dismisses once its duration elapses', () => {
    const onOpenChange = vi.fn();
    show({ onOpenChange });
    expect(onOpenChange).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(4000));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not run the dismissal timer while closed', () => {
    const onOpenChange = vi.fn();
    render(<Toast open={false} title="hidden" onOpenChange={onOpenChange} />);
    act(() => void vi.advanceTimersByTime(10000));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('carries a labelled close control', () => {
    const onOpenChange = vi.fn();
    show({ onOpenChange });
    screen.getByRole('button', { name: 'Dismiss' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('rides the current scale, never the retired palette', () => {
    show({ tone: 'danger' });
    const cls = String(screen.getByRole('status').className);
    expect(cls).not.toMatch(/text-(fg|muted|faint)\b|bg-(surface|raised|base|subtle)\b/);
  });
});
