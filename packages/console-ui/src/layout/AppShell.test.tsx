// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell.js';

describe('AppShell', () => {
  it('renders the wordmark, workspace name, and the content slot', () => {
    render(
      <AppShell platform="win32" workspaceName="myproject" onRaw={() => {}}>
        <div data-testid="slot">content</div>
      </AppShell>,
    );
    expect(screen.getByText('co·a')).toBeTruthy();
    expect(screen.getByText('myproject')).toBeTruthy();
    expect(screen.getByTestId('slot')).toBeTruthy();
  });

  it('always exposes a focusable raw affordance that fires onRaw', async () => {
    const onRaw = vi.fn();
    render(
      <AppShell platform="win32" workspaceName="p" onRaw={onRaw}>
        <div />
      </AppShell>,
    );
    const raw = screen.getByRole('button', { name: 'raw' });
    raw.focus();
    expect(document.activeElement).toBe(raw);
    await userEvent.click(raw);
    expect(onRaw).toHaveBeenCalledTimes(1);
  });

  it('applies the macOS traffic-light inset', () => {
    const { container } = render(
      <AppShell platform="darwin" workspaceName="p" onRaw={() => {}}>
        <div />
      </AppShell>,
    );
    const header = container.querySelector('header');
    expect(header?.style.paddingLeft).toBe('78px');
  });

  it('shows account context only when provided', () => {
    const { rerender } = render(
      <AppShell platform="win32" workspaceName="p" onRaw={() => {}}>
        <div />
      </AppShell>,
    );
    expect(screen.queryByTestId('account-context')).toBeNull();
    rerender(
      <AppShell platform="win32" workspaceName="p" account="Pro·acct-1" onRaw={() => {}}>
        <div />
      </AppShell>,
    );
    expect(screen.getByText('Pro·acct-1')).toBeTruthy();
  });
});
