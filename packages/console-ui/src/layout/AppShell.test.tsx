// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell.js';

describe('AppShell', () => {
  it('renders the wordmark, workspace name, and the content slot', () => {
    render(
      <AppShell platform="win32" workspaceName="myproject">
        <div data-testid="slot">content</div>
      </AppShell>,
    );
    expect(screen.getByText('co·a')).toBeTruthy();
    expect(screen.getByText('myproject')).toBeTruthy();
    expect(screen.getByTestId('slot')).toBeTruthy();
  });

  it('applies the macOS traffic-light inset', () => {
    const { container } = render(
      <AppShell platform="darwin" workspaceName="p">
        <div />
      </AppShell>,
    );
    const header = container.querySelector('header');
    expect(header?.style.paddingLeft).toBe('78px');
  });

  it('shows account context only when provided', () => {
    const { rerender } = render(
      <AppShell platform="win32" workspaceName="p">
        <div />
      </AppShell>,
    );
    expect(screen.queryByTestId('account-context')).toBeNull();
    rerender(
      <AppShell platform="win32" workspaceName="p" account="Pro·acct-1">
        <div />
      </AppShell>,
    );
    expect(screen.getByText('Pro·acct-1')).toBeTruthy();
  });
});
