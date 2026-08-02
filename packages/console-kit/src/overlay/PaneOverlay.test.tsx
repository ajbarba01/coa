// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PaneOverlayProvider, usePaneOverlay } from './PaneOverlay.js';

function Opener(): React.JSX.Element {
  const overlay = usePaneOverlay();
  return <button onClick={() => overlay?.open(<p>FULL BODY</p>, 'Detail')}>open</button>;
}

function NullProbe(): React.JSX.Element {
  return <span>{usePaneOverlay() === null ? 'no-provider' : 'has-provider'}</span>;
}

describe('PaneOverlay', () => {
  it('opens content inside the provider container (contained, not portalled to body)', async () => {
    const { container } = render(
      <PaneOverlayProvider>
        <Opener />
      </PaneOverlayProvider>,
    );
    expect(screen.queryByText('FULL BODY')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('open'));
    const body = screen.getByText('FULL BODY');
    expect(body).toBeInTheDocument();
    expect(container.contains(body)).toBe(true); // confined to the pane, not document.body
  });

  it('closes on the close button and on Escape', async () => {
    render(
      <PaneOverlayProvider>
        <Opener />
      </PaneOverlayProvider>,
    );
    await userEvent.click(screen.getByText('open'));
    await userEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(screen.queryByText('FULL BODY')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('open'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('FULL BODY')).not.toBeInTheDocument();
  });

  it('marks the overlay as a modal dialog', async () => {
    render(
      <PaneOverlayProvider>
        <Opener />
      </PaneOverlayProvider>,
    );
    await userEvent.click(screen.getByText('open'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Detail');
  });

  it('moves initial focus into the overlay and restores it to the opener on close', async () => {
    render(
      <PaneOverlayProvider>
        <Opener />
      </PaneOverlayProvider>,
    );
    const opener = screen.getByText('open');
    opener.focus();
    await userEvent.click(opener);
    // Initial focus lands on the close button (inside the overlay), not the opener behind it.
    expect(screen.getByRole('button', { name: /^close$/i })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    // Focus returns to the control that opened the overlay.
    expect(opener).toHaveFocus();
  });

  it('usePaneOverlay returns null with no provider', () => {
    render(<NullProbe />);
    expect(screen.getByText('no-provider')).toBeInTheDocument();
  });

  it('wears the sand scale, not the legacy semantic tokens', async () => {
    render(
      <PaneOverlayProvider>
        <Opener />
      </PaneOverlayProvider>,
    );
    await userEvent.click(screen.getByText('open'));
    const panel = screen.getByRole('dialog').querySelector('.relative.m-3');
    expect(panel?.className).toMatch(/border-s5/);
    expect(panel?.className).toMatch(/bg-s2/);
    expect(panel?.className).not.toMatch(/border-border-default|bg-raised|rounded-overlay/);
  });
});
