import type { Adjustability, LayoutDescriptor } from '../descriptor/schema.js';
import type { PanelRegistry } from '../panel/registry.js';

export interface LayoutMountArgs {
  container: HTMLElement;
  descriptor: LayoutDescriptor;
  registry: PanelRegistry;
  daemonState: unknown;
  /** Fires whenever the arrangement changes (e.g. a resize). */
  onChange: (descriptor: LayoutDescriptor) => void;
}

export interface LayoutHandle {
  serialize(): LayoutDescriptor;
  /** Swap in a new descriptor and re-render. `remountGroups` (default `true`)
   *  forces the resize groups to remount, which a *structural* change needs so the
   *  resize library re-reads its panels. Pass `false` for a same-shape swap — e.g. a
   *  route change that only rewrites one leaf's `panelId` — so the tree reconciles in
   *  place instead of tearing down and rebuilding (which flickers the whole window). */
  applyDescriptor(descriptor: LayoutDescriptor, remountGroups?: boolean): void;
  /** Push fresh daemon state into the mounted panels. Re-runs each panel's
   *  pure selectVm and re-renders WITHOUT remounting the resize groups (drag
   *  state is preserved). */
  setDaemonState(state: unknown): void;
  focusPanel(id: string): void;
  dispose(): void;
}

/** The one seam that knows whether arrangement is mutable. Swapping this (Static ->
 *  Dockview) does not touch panels or descriptors. */
export interface LayoutEngine {
  readonly id: string;
  readonly supports: ReadonlySet<Adjustability>;
  mount(args: LayoutMountArgs): LayoutHandle;
}
