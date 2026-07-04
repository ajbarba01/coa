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

  it('renders the window-controls slot when provided (no right-edge reserve)', () => {
    const { container } = render(
      <AppShell
        platform="win32"
        workspaceName="p"
        windowControls={<div data-testid="win-controls" />}
      >
        <div />
      </AppShell>,
    );
    expect(screen.getByTestId('win-controls')).toBeTruthy();
    // Windows draws its own controls, so the bar no longer reserves right padding.
    const header = container.querySelector('header');
    expect(header?.style.paddingRight).toBe('');
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
