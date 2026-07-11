// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import { useClickAway, useDismissLayer } from './layers.js';

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
