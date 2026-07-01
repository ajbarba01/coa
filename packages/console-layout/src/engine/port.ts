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
  applyDescriptor(descriptor: LayoutDescriptor): void;
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
