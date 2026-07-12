// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeferredCanvas, Freeze } from './deferredMount.js';

describe('Freeze', () => {
  it('skips re-rendering its subtree while frozen and catches up on thaw', () => {
    const renders = vi.fn();
    function Probe({ label }: { label: string }): React.JSX.Element {
      renders(label);
      return <div data-testid="probe">{label}</div>;
    }
    const { rerender } = render(
      <Freeze frozen={false}>
        <Probe label="v1" />
      </Freeze>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('v1');

    rerender(
      <Freeze frozen>
        <Probe label="v2" />
      </Freeze>,
    );
    // frozen: the hidden canvas must NOT pay for this update
    expect(screen.getByTestId('probe')).toHaveTextContent('v1');
    expect(renders).toHaveBeenCalledTimes(1);

    rerender(
      <Freeze frozen={false}>
        <Probe label="v3" />
      </Freeze>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('v3');
  });
});

describe('DeferredCanvas', () => {
  it('paints the loading circle first and mounts content when the transition lands', () => {
    const pending: Array<() => void> = [];
    render(
      <DeferredCanvas id="a" transition={(cb) => pending.push(cb)}>
        <div data-testid="content-a">A</div>
      </DeferredCanvas>,
    );
    // The mount itself is deferred — the urgent frame is the spinner.
    expect(screen.queryByTestId('content-a')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => pending.shift()?.());
    expect(screen.getByTestId('content-a')).toBeInTheDocument();
  });

  it('routes an id change back through the loading circle', () => {
    const pending: Array<() => void> = [];
    const { rerender } = render(
      <DeferredCanvas id="a" transition={(cb) => pending.push(cb)}>
        <div data-testid="content-a">A</div>
      </DeferredCanvas>,
    );
    act(() => pending.shift()?.());
    rerender(
      <DeferredCanvas id="b" transition={(cb) => pending.push(cb)}>
        <div data-testid="content-b">B</div>
      </DeferredCanvas>,
    );
    expect(screen.queryByTestId('content-b')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => pending.shift()?.());
    expect(screen.getByTestId('content-b')).toBeInTheDocument();
  });

  it('same id re-renders flow straight through (no spinner round-trip)', () => {
    const pending: Array<() => void> = [];
    const { rerender } = render(
      <DeferredCanvas id="a" transition={(cb) => pending.push(cb)}>
        <div data-testid="content-a">A</div>
      </DeferredCanvas>,
    );
    act(() => pending.shift()?.());
    rerender(
      <DeferredCanvas id="a" transition={(cb) => pending.push(cb)}>
        <div data-testid="content-a">A2</div>
      </DeferredCanvas>,
    );
    expect(screen.getByTestId('content-a')).toHaveTextContent('A2');
    expect(pending).toHaveLength(0);
  });
});
