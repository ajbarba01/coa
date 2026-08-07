import { create } from 'zustand';
import type { ModelCatalogView, ModelEntry, ReasoningProfile } from '@coa/console-viewmodel';
import {
  notifyModelsChanged,
  rpcAddCustomModel,
  rpcAddModels,
  rpcEditModel,
  rpcModelCatalog,
  rpcRemoveModel,
  rpcSetModelHidden,
} from '../console.js';

/**
 * The model editor's data, LIVE from the daemon (the authStore pattern): hydrate
 * reads `modelCatalog`; every write calls its RPC verb and reprojects the
 * returned view — the store never computes lists itself. After a write it also
 * pokes the controller's `loadModels`, because the effective picker feed
 * (`state.data.models`) is a projection of what was just edited.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function profileOf(entry: ModelEntry): ReasoningProfile {
  return entry.reasoning ?? { kind: 'inherit' };
}

export function entryLabel(entry: ModelEntry): string {
  return entry.label ?? entry.id;
}

/** The one-line summary a reasoning profile wears in the editor row. */
export function reasoningSummary(p: ReasoningProfile): string {
  switch (p.kind) {
    case 'inherit':
      return 'inherits';
    case 'none':
      return 'no reasoning';
    case 'effort':
      return `effort · up to ${p.max}`;
    case 'thinking':
      return 'thinking toggle';
    case 'budget':
      return `budget · ${p.tokens.toLocaleString()} tok`;
  }
}

/** What "add from defaults" can still offer: the catalog minus the current list. */
export function offerable(catalog: ModelEntry[], list: ModelEntry[]): ModelEntry[] {
  const have = new Set(list.map((m) => m.id));
  return catalog.filter((m) => !have.has(m.id));
}

interface ModelsState {
  lists: Record<string, ModelEntry[]>;
  catalog: Record<string, ModelEntry[]>;
  hydrate: () => Promise<void>;
  addFromDefaults: (providerId: string, ids: string[]) => Promise<void>;
  addCustom: (
    providerId: string,
    entry: { id: string; label?: string; reasoning?: ReasoningProfile },
  ) => Promise<void>;
  editModel: (
    providerId: string,
    id: string,
    patch: { label?: string; reasoning?: ReasoningProfile },
  ) => Promise<void>;
  setHidden: (providerId: string, id: string, hidden: boolean) => Promise<void>;
  removeModel: (providerId: string, id: string) => Promise<void>;
}

export const useModels = create<ModelsState>((set) => {
  const apply = (view: ModelCatalogView): void => set({ lists: view.lists, catalog: view.catalog });
  /** Write → reproject → refresh the effective feed (the pickers' projection). */
  const applyAndNotify = async (view: ModelCatalogView): Promise<void> => {
    apply(view);
    await notifyModelsChanged();
  };
  return {
    lists: {},
    catalog: {},
    hydrate: async () => apply(await rpcModelCatalog()),
    addFromDefaults: async (providerId, ids) =>
      applyAndNotify(await rpcAddModels({ providerId, ids })),
    addCustom: async (providerId, entry) =>
      applyAndNotify(await rpcAddCustomModel({ providerId, ...entry })),
    editModel: async (providerId, id, patch) =>
      applyAndNotify(await rpcEditModel({ providerId, id, ...patch })),
    setHidden: async (providerId, id, hidden) =>
      applyAndNotify(await rpcSetModelHidden({ providerId, id, hidden })),
    removeModel: async (providerId, id) => applyAndNotify(await rpcRemoveModel({ providerId, id })),
  };
});
