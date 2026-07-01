import type { ComponentType } from 'react';

/** The panel's view of its host. A strict SUBSET of dockview's panel api, so a
 *  panel written today runs unchanged under a docking engine tomorrow. */
export interface PanelHostApi {
  readonly title: string;
  setTitle(title: string): void;
  /** Subscribe to visibility changes; returns an unsubscribe. */
  onVisibilityChange(cb: (visible: boolean) => void): () => void;
  requestFocus(): void;
}

export interface PanelConstraints {
  minWidth?: number;
  minHeight?: number;
}

/** A panel is a pure view module: a component + a pure daemon-state -> view-model
 *  selector. It never imports the engine or the descriptor. */
export interface PanelDefinition<VM = unknown, S = unknown> {
  id: string;
  displayName: string;
  render: ComponentType<{ vm: VM; host: PanelHostApi }>;
  selectVm: (daemonState: S) => VM;
  defaultConstraints?: PanelConstraints;
}

export interface PanelRegistry {
  register<VM, S>(def: PanelDefinition<VM, S>): void;
  resolve(id: string): PanelDefinition | undefined;
  has(id: string): boolean;
}

export function createPanelRegistry(): PanelRegistry {
  const panels = new Map<string, PanelDefinition>();
  return {
    register(def) {
      if (panels.has(def.id)) {
        throw new Error(`Panel already registered: ${def.id}`);
      }
      // Store erased: the registry is heterogeneous over VM/S. The public
      // register<VM,S> keeps callers type-safe; the internal store is existential.
      panels.set(def.id, def as unknown as PanelDefinition);
    },
    resolve(id) {
      return panels.get(id);
    },
    has(id) {
      return panels.has(id);
    },
  };
}
