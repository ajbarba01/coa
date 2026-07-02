// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DaemonStatus } from './DaemonStatus.js';

const actions = () => ({ onStart: vi.fn(), onStop: vi.fn(), onRestart: vi.fn() });

describe('DaemonStatus', () => {
  it('labels the trigger with the current status', () => {
    render(<DaemonStatus status="running" {...actions()} />);
    expect(screen.getByRole('button', { name: 'Daemon: Running' })).toBeTruthy();
  });

  it('shows a spinner while starting', () => {
    render(<DaemonStatus status="starting" {...actions()} />);
    expect(screen.getByRole('status', { name: 'Daemon starting' })).toBeTruthy();
  });

  it('when running, disables Start and lets Restart fire', async () => {
    const a = actions();
    render(<DaemonStatus status="running" {...a} />);
    await userEvent.click(screen.getByRole('button', { name: 'Daemon: Running' }));

    // Assert sibling states while the menu is open (a click closes it).
    expect(await screen.findByRole('menuitem', { name: 'Start' })).toHaveAttribute('data-disabled');
    expect(screen.getByRole('menuitem', { name: 'Restart' })).not.toHaveAttribute('data-disabled');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Restart' }));
    expect(a.onRestart).toHaveBeenCalledOnce();
  });

  it('when stopped, disables Stop/Restart and lets Start fire', async () => {
    const a = actions();
    render(<DaemonStatus status="stopped" {...a} />);
    await userEvent.click(screen.getByRole('button', { name: 'Daemon: Stopped' }));

    expect(await screen.findByRole('menuitem', { name: 'Stop' })).toHaveAttribute('data-disabled');
    expect(screen.getByRole('menuitem', { name: 'Restart' })).toHaveAttribute('data-disabled');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Start' }));
    expect(a.onStart).toHaveBeenCalledOnce();
  });
});
