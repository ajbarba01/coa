// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useDismissLayer } from './layers.js';
import { MenuItem } from './MenuCard.js';
import { PopoverCard } from './PopoverCard.js';

function Host(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <PopoverCard
      open={open}
      onOpenChange={setOpen}
      trigger={<button type="button">chip</button>}
    >
      <MenuItem onClick={() => setOpen(false)}>option</MenuItem>
    </PopoverCard>
  );
}

describe('PopoverCard', () => {
  it('opens from the trigger, wears the menu surface, closes on item pick', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'chip' }));
    const item = screen.getByRole('button', { name: /option/ });
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(screen.queryByRole('button', { name: /option/ })).not.toBeInTheDocument();
  });

  it('Escape closes it through the kit layer stack (real bubble path)', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'chip' }));
    expect(screen.getByRole('button', { name: /option/ })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /option/ })).not.toBeInTheDocument();
  });

  it('with a bespoke layer stacked above, Escape closes only that layer; the popover survives', () => {
    const modeClosed = vi.fn();

    function Mode({ onClose }: { onClose: () => void }): React.JSX.Element {
      useDismissLayer(true, onClose);
      return <div data-testid="mode" />;
    }

    function Stack(): React.JSX.Element {
      const [open, setOpen] = useState(false);
      const [mode, setMode] = useState(false);
      // the upper layer arrives by keyboard, like the app's search mode —
      // a pointer press would legitimately close the popover as outside-press
      useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
          if (e.key === 'F2') setMode(true);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, []);
      return (
        <>
          <PopoverCard open={open} onOpenChange={setOpen} trigger={<button type="button">chip</button>}>
            <MenuItem>option</MenuItem>
          </PopoverCard>
          {mode && (
            <Mode
              onClose={() => {
                modeClosed();
                setMode(false);
              }}
            />
          )}
        </>
      );
    }

    render(<Stack />);
    fireEvent.click(screen.getByRole('button', { name: 'chip' }));
    fireEvent.keyDown(window, { key: 'F2' });
    expect(screen.getByTestId('mode')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(modeClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('mode')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /option/ })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /option/ })).not.toBeInTheDocument();
  });
});
