// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import { hasOpenLayers, useClickAway, useDismissLayer, useExclusivePopover } from './layers.js';

function Layer({ name, onClose }: { name: string; onClose: () => void }): React.JSX.Element {
  useDismissLayer(true, onClose);
  return <div>{name}</div>;
}

describe('useDismissLayer', () => {
  it('Escape closes ONLY the topmost layer, in reverse open order', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <Layer name="first" onClose={first} />
        <Layer name="second" onClose={second} />
      </>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('hasOpenLayers reflects the live stack', () => {
    const { unmount } = render(<Layer name="only" onClose={vi.fn()} />);
    expect(hasOpenLayers()).toBe(true);
    unmount();
    expect(hasOpenLayers()).toBe(false);
  });

  it('an unmounted layer no longer intercepts Escape', () => {
    const under = vi.fn();
    const over = vi.fn();
    const { rerender } = render(
      <>
        <Layer name="under" onClose={under} />
        <Layer name="over" onClose={over} />
      </>,
    );
    rerender(<Layer name="under" onClose={under} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(over).not.toHaveBeenCalled();
    expect(under).toHaveBeenCalledTimes(1);
  });
});

function Menu({
  open,
  onClose,
  on,
}: {
  open: boolean;
  onClose: () => void;
  /** The node this menu was invoked on (the sub-layer cases). */
  on?: Node;
}): React.JSX.Element {
  useExclusivePopover(open, onClose, { invokedOn: on });
  return <div />;
}

/** A menu that declares its own DOM, the way PopoverCard passes its popup. */
function HostMenu({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  useExclusivePopover(open, onClose, { rootRef: root });
  return (
    <div ref={root}>
      <input data-testid="host-field" />
    </div>
  );
}

describe('useExclusivePopover', () => {
  it('opening one menu closes whichever menu was open before it — never two at once', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    const { rerender } = render(
      <>
        <Menu open onClose={closeA} />
        <Menu open={false} onClose={closeB} />
      </>,
    );
    expect(closeA).not.toHaveBeenCalled();
    rerender(
      <>
        <Menu open onClose={closeA} />
        <Menu open onClose={closeB} />
      </>,
    );
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
  });

  it('a right-click that no menu claims closes the open one', async () => {
    const onClose = vi.fn();
    render(<Menu open onClose={onClose} />);
    fireEvent.contextMenu(window);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('a claimed right-click (defaultPrevented) closes nothing — the claimer owns it', async () => {
    const onClose = vi.fn();
    render(<Menu open onClose={onClose} />);
    const claim = (e: Event): void => e.preventDefault();
    window.addEventListener('contextmenu', claim);
    fireEvent.contextMenu(window);
    await new Promise((r) => setTimeout(r, 0));
    expect(onClose).not.toHaveBeenCalled();
    window.removeEventListener('contextmenu', claim);
  });

  it('a closed menu releases the slot — a later right-click closes nothing stale', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Menu open onClose={onClose} />);
    rerender(<Menu open={false} onClose={onClose} />);
    fireEvent.contextMenu(window);
    await new Promise((r) => setTimeout(r, 0));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a menu invoked INSIDE the open one is a sub-layer — the host stays open', () => {
    const closeHost = vi.fn();
    const closeSub = vi.fn();
    const { getByTestId, rerender } = render(
      <>
        <HostMenu open onClose={closeHost} />
        <Menu open={false} onClose={closeSub} />
      </>,
    );
    const field = getByTestId('host-field');
    rerender(
      <>
        <HostMenu open onClose={closeHost} />
        <Menu open onClose={closeSub} on={field} />
      </>,
    );
    expect(closeHost).not.toHaveBeenCalled();
  });

  it('the host keeps the slot under a sub-layer — an unclaimed right-click still closes IT', async () => {
    const closeHost = vi.fn();
    const { getByTestId, rerender } = render(<HostMenu open onClose={closeHost} />);
    const field = getByTestId('host-field');
    rerender(
      <>
        <HostMenu open onClose={closeHost} />
        <Menu open onClose={vi.fn()} on={field} />
      </>,
    );
    fireEvent.contextMenu(window);
    await waitFor(() => expect(closeHost).toHaveBeenCalledTimes(1));
  });

  it('a menu invoked OUTSIDE the open one replaces it as ever', () => {
    const closeHost = vi.fn();
    const { getByTestId, rerender } = render(
      <>
        <HostMenu open onClose={closeHost} />
        <div data-testid="elsewhere" />
      </>,
    );
    const elsewhere = getByTestId('elsewhere');
    rerender(
      <>
        <HostMenu open onClose={closeHost} />
        <div data-testid="elsewhere" />
        <Menu open onClose={vi.fn()} on={elsewhere} />
      </>,
    );
    expect(closeHost).toHaveBeenCalledTimes(1);
  });
});

function Away({ onAway, portal }: { onAway: () => void; portal: boolean }): React.JSX.Element {
  const trigger = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useClickAway([trigger, menu], onAway);
  return (
    <>
      <div ref={trigger} data-testid="trigger" />
      {portal && createPortal(<div ref={menu} data-testid="menu" />, document.body)}
      <div data-testid="outside" />
    </>
  );
}

describe('useClickAway', () => {
  it('pointerdown outside every ref fires; inside any ref (incl. a portaled one) does not', () => {
    const onAway = vi.fn();
    const { getByTestId } = render(<Away onAway={onAway} portal />);
    fireEvent.pointerDown(getByTestId('trigger'));
    fireEvent.pointerDown(getByTestId('menu'));
    expect(onAway).not.toHaveBeenCalled();
    fireEvent.pointerDown(getByTestId('outside'));
    expect(onAway).toHaveBeenCalledTimes(1);
  });

  it('still fires with only some refs mounted (an unopened portal is not "inside")', () => {
    const onAway = vi.fn();
    const { getByTestId } = render(<Away onAway={onAway} portal={false} />);
    fireEvent.pointerDown(getByTestId('outside'));
    expect(onAway).toHaveBeenCalledTimes(1);
  });

  it('does nothing while NO ref is mounted (the empty guard)', () => {
    const onAway = vi.fn();
    function NoRefs(): React.JSX.Element {
      const never = useRef<HTMLDivElement>(null);
      useClickAway(never, onAway);
      return <div data-testid="outside" />;
    }
    const { getByTestId } = render(<NoRefs />);
    fireEvent.pointerDown(getByTestId('outside'));
    expect(onAway).not.toHaveBeenCalled();
  });
});
