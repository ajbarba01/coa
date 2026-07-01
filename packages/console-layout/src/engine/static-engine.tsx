import { Fragment, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { Adjustability, LayoutDescriptor, Region } from '../descriptor/schema.js';
import type { PanelHostApi, PanelRegistry } from '../panel/registry.js';
import type { LayoutEngine, LayoutHandle, LayoutMountArgs } from './port.js';

const SUPPORTED: ReadonlySet<Adjustability> = new Set<Adjustability>(['static', 'resizable']);

/** Mutable, React-external state so the imperative handle can drive/read the tree
 *  without React re-rendering on every drag (which would fight the resize lib).
 *  `layoutRevision` keys the resize groups (bumped only on a descriptor swap);
 *  `version` is the render trigger (bumped on ANY change, incl. a data tick), so
 *  fresh data re-renders panels without remounting — and resetting — the groups. */
interface LayoutStore {
  current: LayoutDescriptor;
  daemonState: unknown;
  layoutRevision: number;
  version: number;
  focusTargets: Map<string, HTMLElement>;
  listeners: Set<() => void>;
}

function notify(store: LayoutStore): void {
  for (const l of store.listeners) l();
}

interface RenderCtx {
  store: LayoutStore;
  registry: PanelRegistry;
  onChange: (d: LayoutDescriptor) => void;
}

/** First panel id under a region — used to label a splitter by an adjacent panel. */
function firstPanelId(region: Region): string | undefined {
  if (region.type === 'leaf') return region.panelId;
  for (const child of region.children) {
    const id = firstPanelId(child);
    if (id !== undefined) return id;
  }
  return undefined;
}

function separatorLabel(ctx: RenderCtx, before: Region, after: Region): string {
  const a = firstPanelId(before);
  const b = firstPanelId(after);
  const nameA = (a !== undefined && ctx.registry.resolve(a)?.displayName) || 'region';
  const nameB = (b !== undefined && ctx.registry.resolve(b)?.displayName) || 'region';
  return `Resize ${nameA} and ${nameB}`;
}

function setLeafSize(region: Region, size: number | undefined): Region {
  if (size === undefined || region.type !== 'leaf') return region;
  return { ...region, size };
}

/** Fold new sizes reported by a PanelGroup back into the descriptor at `path`
 *  (dot-joined child indices under root). */
function updateSizesAtPath(
  desc: LayoutDescriptor,
  path: string,
  sizes: number[],
): LayoutDescriptor {
  const indices = path.split('.').slice(1).map(Number);
  function recur(region: Region, depth: number): Region {
    if (region.type !== 'split') return region;
    if (depth === indices.length) {
      return { ...region, children: region.children.map((c, i) => setLeafSize(c, sizes[i])) };
    }
    const idx = indices[depth];
    return {
      ...region,
      children: region.children.map((c, i) => (i === idx ? recur(c, depth + 1) : c)),
    };
  }
  return { ...desc, root: recur(desc.root, 0) };
}

function PanelBody({
  region,
  ctx,
}: {
  region: LeafRegionProp;
  ctx: RenderCtx;
}): React.JSX.Element | null {
  const def = ctx.registry.resolve(region.panelId);
  if (!def) return null; // defensive: parseDescriptor already dropped unknowns
  const vm = def.selectVm(ctx.store.daemonState);
  const Render = def.render;
  const host: PanelHostApi = {
    title: def.displayName,
    setTitle: () => {}, // inert under StaticEngine; lights up under dockview
    onVisibilityChange: () => () => {}, // panels are always visible in the static layout
    requestFocus: () => ctx.store.focusTargets.get(region.panelId)?.focus(),
  };
  return (
    <div
      data-panel-id={region.panelId}
      tabIndex={-1}
      ref={(el) => {
        if (el) ctx.store.focusTargets.set(region.panelId, el);
        else ctx.store.focusTargets.delete(region.panelId);
      }}
      style={{ minWidth: 0, minHeight: 0, height: '100%', width: '100%' }}
    >
      <Render vm={vm} host={host} />
    </div>
  );
}

type LeafRegionProp = Extract<Region, { type: 'leaf' }>;

function renderRegion(region: Region, ctx: RenderCtx, path: string): React.JSX.Element {
  if (region.type === 'leaf') {
    return <PanelBody region={region} ctx={ctx} />;
  }
  // A `dockable` region degrades to `resizable` under the StaticEngine.
  const resizable = region.adjustability !== 'static';
  if (!resizable) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: region.direction === 'row' ? 'row' : 'column',
          minWidth: 0,
          minHeight: 0,
          height: '100%',
          width: '100%',
        }}
      >
        {region.children.map((child, i) => (
          <div
            key={i}
            style={{
              flex: child.type === 'leaf' && child.size ? `${child.size} 1 0` : '1 1 0',
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {renderRegion(child, ctx, `${path}.${i}`)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <PanelGroup
      key={`${path}:${ctx.store.layoutRevision}`}
      direction={region.direction === 'row' ? 'horizontal' : 'vertical'}
      onLayout={(sizes: number[]) => {
        ctx.store.current = updateSizesAtPath(ctx.store.current, path, sizes);
        ctx.onChange(ctx.store.current);
      }}
    >
      {region.children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <PanelResizeHandle
              aria-label={separatorLabel(ctx, region.children[i - 1] as Region, child)}
            />
          )}
          <Panel defaultSize={child.type === 'leaf' ? child.size : undefined} minSize={5}>
            {renderRegion(child, ctx, `${path}.${i}`)}
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  );
}

function StaticRoot({ ctx }: { ctx: RenderCtx }): React.JSX.Element {
  useSyncExternalStore(
    (cb) => {
      ctx.store.listeners.add(cb);
      return () => ctx.store.listeners.delete(cb);
    },
    () => ctx.store.version,
  );
  return (
    <div style={{ height: '100%', width: '100%' }}>
      {renderRegion(ctx.store.current.root, ctx, 'root')}
    </div>
  );
}

export function createStaticEngine(): LayoutEngine {
  return {
    id: 'static',
    supports: SUPPORTED,
    mount({
      container,
      descriptor,
      registry,
      daemonState,
      onChange,
    }: LayoutMountArgs): LayoutHandle {
      const store: LayoutStore = {
        current: descriptor,
        daemonState,
        layoutRevision: 0,
        version: 0,
        focusTargets: new Map(),
        listeners: new Set(),
      };
      const ctx: RenderCtx = { store, registry, onChange };
      const root = createRoot(container);
      root.render(<StaticRoot ctx={ctx} />);
      return {
        serialize: () => store.current,
        applyDescriptor: (d) => {
          store.current = d;
          store.layoutRevision += 1;
          store.version += 1;
          notify(store);
        },
        setDaemonState: (state) => {
          store.daemonState = state;
          store.version += 1;
          notify(store);
        },
        focusPanel: (id) => store.focusTargets.get(id)?.focus(),
        dispose: () => root.unmount(),
      };
    },
  };
}
