// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ZoomProvider } from '../zoom.js';
import { PanelResize } from './PanelResize.js';

describe('PanelResize', () => {
  it('reports layout px during a drag and stops after pointerup', () => {
    const onDrag = vi.fn();
    render(
      <ZoomProvider value={2}>
        <PanelResize onDrag={onDrag} onReset={() => {}} />
      </ZoomProvider>,
    );
    const sep = screen.getByRole('separator', { name: /^resize panel$/i });
    fireEvent.pointerDown(sep, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(sep, { clientX: 240 });
    expect(onDrag).toHaveBeenLastCalledWith(120);
    fireEvent.pointerUp(sep, { pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 300 });
    expect(onDrag).toHaveBeenCalledTimes(1);
  });

  it('double-click resets; activity is reported both ways', () => {
    const onReset = vi.fn();
    const onActiveChange = vi.fn();
    render(<PanelResize onDrag={() => {}} onReset={onReset} onActiveChange={onActiveChange} />);
    const sep = screen.getByRole('separator');
    fireEvent.doubleClick(sep);
    expect(onReset).toHaveBeenCalled();
    fireEvent.pointerDown(sep, { pointerId: 1 });
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    fireEvent.pointerUp(sep, { pointerId: 1 });
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });
});
