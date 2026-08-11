// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeferredCanvas } from './deferredMount.js';

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
