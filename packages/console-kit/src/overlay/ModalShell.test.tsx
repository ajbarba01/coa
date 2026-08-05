// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ModalShell } from './ModalShell.js';
import { PopoverCard } from './PopoverCard.js';

describe('ModalShell', () => {
  it('renders a labelled dialog and contains focus inside it', async () => {
    render(
      <ModalShell open onClose={() => {}} aria-label="settings">
        <button type="button">first</button>
      </ModalShell>,
    );
    const dialog = screen.getByRole('dialog', { name: 'settings' });
    expect(dialog).toBeInTheDocument();
    // Base UI moves initial focus on a deferred frame
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('Escape closes it through the kit layer stack (real bubble path)', () => {
    const onClose = vi.fn();
    render(<ModalShell open onClose={onClose} aria-label="x" />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closed renders nothing', () => {
    render(<ModalShell open={false} onClose={() => {}} aria-label="x" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('dismisses a menu that was open when it opened, rather than letting it float over the card', async () => {
    function Host({ modal }: { modal: boolean }): React.JSX.Element {
      const [menu, setMenu] = useState(true);
      return (
        <>
          <PopoverCard
            open={menu}
            onOpenChange={setMenu}
            trigger={<button type="button">a menu</button>}
          >
            <div>menu body</div>
          </PopoverCard>
          <ModalShell open={modal} onClose={() => {}} aria-label="settings" />
        </>
      );
    }
    // Opened with NO pointer press — a keyboard shortcut, a palette command, a menu item.
    // Clicking a trigger would be an outside-press, which already closes the menu on its
    // own and would let this pass without the rule under test existing at all.
    const { rerender } = render(<Host modal={false} />);
    expect(screen.getByText('menu body')).toBeInTheDocument();
    rerender(<Host modal />);
    // A dropdown portals ABOVE the modal by design (a select inside a dialog has to
    // work), so a menu left open would render over the card it no longer belongs to.
    await waitFor(() => expect(screen.queryByText('menu body')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'settings' })).toBeInTheDocument();
  });
});
