// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startConsole, type ConsoleBridge } from './console.js';

function fakeBridge(over: Partial<ConsoleBridge> = {}): ConsoleBridge {
  return {
    capState: vi.fn().mockResolvedValue({ remaining: 2.5, capHit: false }),
    getLayout: vi.fn().mockResolvedValue(undefined),
    saveLayout: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('startConsole', () => {
  it('mounts the default layout and shows the cost surface loading, then live', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let controller!: Awaited<ReturnType<typeof startConsole>>;
    await act(async () => {
      controller = await startConsole(container, fakeBridge());
    });
    // nav + conversation placeholder + cost pane all present; cost starts loading.
    expect(container.querySelector('[data-panel-id="cost"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="nav"]')).not.toBeNull();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    await act(async () => {
      await controller.refresh();
    });
    expect(container.textContent).toContain('$2.50 left');
  });

  it('falls back to the default layout when persisted layout is corrupt', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      await startConsole(
        container,
        fakeBridge({ getLayout: vi.fn().mockResolvedValue('{ not json') }),
      );
    });
    // still the full default tree (conversation + cost present).
    expect(container.querySelector('[data-panel-id="conversation"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="cost"]')).not.toBeNull();
  });
});
