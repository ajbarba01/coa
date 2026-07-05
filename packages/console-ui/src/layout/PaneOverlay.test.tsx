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

  it('usePaneOverlay returns null with no provider', () => {
    render(<NullProbe />);
    expect(screen.getByText('no-provider')).toBeInTheDocument();
  });
});
