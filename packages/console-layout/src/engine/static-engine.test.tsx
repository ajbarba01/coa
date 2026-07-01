// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStaticEngine } from './static-engine.js';
import { createPanelRegistry, type PanelDefinition, type PanelHostApi } from '../panel/registry.js';
import { LAYOUT_VERSION, type LayoutDescriptor } from '../descriptor/schema.js';

function textPanel(id: string): PanelDefinition<string, unknown> {
  return {
    id,
    displayName: id.toUpperCase(),
    render: ({ vm }: { vm: string; host: PanelHostApi }) => <div>{vm}</div>,
    selectVm: () => `panel:${id}`,
  };
}

function mountInto(descriptor: LayoutDescriptor, onChange = vi.fn()) {
  const registry = createPanelRegistry();
  registry.register(textPanel('nav'));
  registry.register(textPanel('chat'));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const engine = createStaticEngine();
  let handle!: ReturnType<typeof engine.mount>;
  act(() => {
    handle = engine.mount({ container, descriptor, registry, daemonState: {}, onChange });
  });
  return { registry, container, handle, onChange };
}

afterEach(() => {
  document.body.innerHTML = '';
});

const staticSplit: LayoutDescriptor = {
  version: LAYOUT_VERSION,
  root: {
    type: 'split',
    direction: 'row',
    adjustability: 'static',
    children: [
      { type: 'leaf', panelId: 'nav' },
      { type: 'leaf', panelId: 'chat' },
    ],
  },
};

const resizableSplit: LayoutDescriptor = {
  version: LAYOUT_VERSION,
  root: {
    type: 'split',
    direction: 'row',
    adjustability: 'resizable',
    children: [
      { type: 'leaf', panelId: 'nav', size: 30 },
      { type: 'leaf', panelId: 'chat', size: 70 },
    ],
  },
};

describe('StaticEngine', () => {
  it('advertises its identity and supported dials', () => {
    const engine = createStaticEngine();
    expect(engine.id).toBe('static');
    expect(engine.supports.has('static')).toBe(true);
    expect(engine.supports.has('resizable')).toBe(true);
    expect(engine.supports.has('dockable')).toBe(false);
  });

  it('renders each panel body via its selectVm', () => {
    const { container } = mountInto(staticSplit);
    expect(container.textContent).toContain('panel:nav');
    expect(container.textContent).toContain('panel:chat');
  });

  it('renders a labelled separator for a resizable split', () => {
    const { container } = mountInto(resizableSplit);
    const seps = container.querySelectorAll('[role="separator"]');
    expect(seps.length).toBe(1);
    expect(seps[0]?.getAttribute('aria-label')?.length).toBeGreaterThan(0);
  });

  it('renders NO separator for a static split', () => {
    const { container } = mountInto(staticSplit);
    expect(container.querySelectorAll('[role="separator"]').length).toBe(0);
  });

  it('exposes each panel body as a focus target keyed by panelId', () => {
    const { container } = mountInto(staticSplit);
    expect(container.querySelector('[data-panel-id="nav"]')).not.toBeNull();
    expect(container.querySelector('[data-panel-id="chat"]')).not.toBeNull();
  });
});

describe('StaticEngine fixed + min sizing', () => {
  it('renders a fixedPx leaf as a non-growing fixed-basis flex child', () => {
    const d: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'static',
        children: [
          { type: 'leaf', panelId: 'nav', fixedPx: 48 },
          { type: 'leaf', panelId: 'chat', minPx: 200 },
        ],
      },
    };
    const { container } = mountInto(d);
    const navWrap = container.querySelector('[data-panel-id="nav"]')?.parentElement as HTMLElement;
    expect(navWrap.style.flex).toContain('48px');
    expect(navWrap.style.flexGrow === '0' || navWrap.style.flex.startsWith('0 0')).toBe(true);
    const chatWrap = container.querySelector('[data-panel-id="chat"]')
      ?.parentElement as HTMLElement;
    expect(chatWrap.style.minWidth).toBe('200px'); // row split → min on the width axis
  });

  it('applies the gutter variable to a static flex container', () => {
    const { container } = mountInto(staticSplit);
    const navWrap = container.querySelector('[data-panel-id="nav"]')?.parentElement as HTMLElement;
    const flexRow = navWrap.parentElement as HTMLElement;
    expect(flexRow.style.gap).toContain('--layout-gap');
  });
});

describe('StaticEngine handle', () => {
  it('serialize returns the current descriptor', () => {
    const { handle } = mountInto(resizableSplit);
    expect(handle.serialize()).toEqual(resizableSplit);
  });

  it('focusPanel moves focus to the panel body', () => {
    const { handle, container } = mountInto(staticSplit);
    act(() => handle.focusPanel('chat'));
    expect(document.activeElement).toBe(container.querySelector('[data-panel-id="chat"]'));
  });

  it('applyDescriptor re-renders and updates serialize', () => {
    const { handle, container } = mountInto(staticSplit);
    const next: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: { type: 'leaf', panelId: 'chat' },
    };
    act(() => handle.applyDescriptor(next));
    expect(handle.serialize()).toEqual(next);
    expect(container.textContent).toContain('panel:chat');
    expect(container.textContent).not.toContain('panel:nav');
  });

  it('remounts the resize groups by default (structural swap)', () => {
    const { handle, container } = mountInto(resizableSplit);
    const before = container.querySelector('[role="separator"]');
    act(() =>
      handle.applyDescriptor({
        version: LAYOUT_VERSION,
        root: {
          type: 'split',
          direction: 'row',
          adjustability: 'resizable',
          children: [
            { type: 'leaf', panelId: 'chat', size: 30 },
            { type: 'leaf', panelId: 'nav', size: 70 },
          ],
        },
      }),
    );
    // Default remounts the group => fresh separator node identity.
    expect(container.querySelector('[role="separator"]')).not.toBe(before);
  });

  it('applies a leaf swap WITHOUT remounting the group when remountGroups is false', () => {
    const { handle, container } = mountInto(resizableSplit);
    const before = container.querySelector('[role="separator"]');
    expect(before).not.toBeNull();
    // Same-structure swap (a route change): only the second leaf's panelId changes.
    act(() =>
      handle.applyDescriptor(
        {
          version: LAYOUT_VERSION,
          root: {
            type: 'split',
            direction: 'row',
            adjustability: 'resizable',
            children: [
              { type: 'leaf', panelId: 'nav', size: 30 },
              { type: 'leaf', panelId: 'nav', size: 70 },
            ],
          },
        },
        false,
      ),
    );
    // The swapped leaf re-rendered its new panel…
    expect(container.textContent).not.toContain('panel:chat');
    // …but the separator node is the same => group reconciled in place, no flicker.
    expect(container.querySelector('[role="separator"]')).toBe(before);
  });

  it('dispose unmounts the tree', () => {
    const { handle, container } = mountInto(staticSplit);
    act(() => handle.dispose());
    expect(container.textContent).toBe('');
  });

  it('degrades a dockable split to a resizable one (renders a separator)', () => {
    const dockable: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'dockable',
        children: [
          { type: 'leaf', panelId: 'nav' },
          { type: 'leaf', panelId: 'chat' },
        ],
      },
    };
    const { container } = mountInto(dockable);
    expect(container.querySelectorAll('[role="separator"]').length).toBe(1);
  });
});

describe('StaticEngine live data (setDaemonState)', () => {
  function dataPanel(id: string): PanelDefinition<number, { n: number }> {
    return {
      id,
      displayName: id.toUpperCase(),
      selectVm: (s) => s.n,
      render: ({ vm }: { vm: number; host: PanelHostApi }) => <div>value:{vm}</div>,
    };
  }

  function mountData(descriptor: LayoutDescriptor, initial: { n: number }) {
    const registry = createPanelRegistry();
    registry.register(dataPanel('nav'));
    registry.register(dataPanel('chat'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const engine = createStaticEngine();
    let handle!: ReturnType<typeof engine.mount>;
    act(() => {
      handle = engine.mount({
        container,
        descriptor,
        registry,
        daemonState: initial,
        onChange: vi.fn(),
      });
    });
    return { container, handle };
  }

  it('re-renders panels when daemon state changes', () => {
    const { container, handle } = mountData(staticSplit, { n: 1 });
    expect(container.textContent).toContain('value:1');
    act(() => handle.setDaemonState({ n: 2 }));
    expect(container.textContent).toContain('value:2');
    expect(container.textContent).not.toContain('value:1');
  });

  it('does not remount the resizable group on a data tick (drag state preserved)', () => {
    const { container, handle } = mountData(resizableSplit, { n: 1 });
    const before = container.querySelector('[role="separator"]');
    expect(before).not.toBeNull();
    act(() => handle.setDaemonState({ n: 2 }));
    const after = container.querySelector('[role="separator"]');
    // Same DOM node identity => React reconciled in place => group not remounted.
    expect(after).toBe(before);
  });
});
