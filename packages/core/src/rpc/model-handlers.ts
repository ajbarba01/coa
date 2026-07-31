import { reasoningProfileSchema, type ModelEntry } from '@coa/shared';
import { z } from 'zod';
import { defaultCatalog } from '../models/default-catalog.js';
import type { ModelCatalogStore } from '../models/model-catalog-store.js';
import { rpcMethod, type RpcHandlers } from './router.js';

/**
 * The model-catalog verbs — the GUI editor's twin of the auth verbs, over the
 * models.yaml store. Every write returns the fresh view (the auth pattern), so
 * the renderer only ever mirrors what the daemon last said. The EFFECTIVE feed
 * (`listModels`) is separate: these verbs edit the SOT, that verb serves its
 * projection.
 */

/** The backends whose model lists are editable. */
export const MODEL_PROVIDERS = ['claude', 'deepseek', 'longcat'] as const;

export interface ModelCatalogView {
  /** provider → the user's list (materialised or catalog-fallback). */
  lists: Record<string, ModelEntry[]>;
  /** provider → the full default catalog ("add from defaults" offers catalog − list). */
  catalog: Record<string, ModelEntry[]>;
}

const noParams = z.unknown().optional();
const addParams = z.object({ providerId: z.string().min(1), ids: z.array(z.string().min(1)) });
const customParams = z.object({
  providerId: z.string().min(1),
  id: z.string().min(1),
  label: z.string().optional(),
  reasoning: reasoningProfileSchema.optional(),
});
const editParams = z.object({
  providerId: z.string().min(1),
  id: z.string().min(1),
  label: z.string().optional(),
  reasoning: reasoningProfileSchema.optional(),
});
const idParams = z.object({ providerId: z.string().min(1), id: z.string().min(1) });
const hiddenParams = z.object({ providerId: z.string().min(1), id: z.string().min(1), hidden: z.boolean() });

export function buildModelHandlers(store: ModelCatalogStore, providers: readonly string[]): RpcHandlers {
  const view = (): ModelCatalogView => {
    const lists: Record<string, ModelEntry[]> = {};
    const catalog: Record<string, ModelEntry[]> = {};
    for (const p of providers) {
      lists[p] = store.listFor(p);
      catalog[p] = defaultCatalog(p);
    }
    return { lists, catalog };
  };

  return {
    modelCatalog: rpcMethod(noParams, () => view()),
    addModels: rpcMethod(addParams, (p) => {
      store.addFromDefaults(p.providerId, p.ids);
      return view();
    }),
    addCustomModel: rpcMethod(customParams, (p) => {
      store.addCustom(p.providerId, {
        id: p.id,
        ...(p.label !== undefined ? { label: p.label } : {}),
        ...(p.reasoning !== undefined ? { reasoning: p.reasoning } : {}),
      });
      return view();
    }),
    editModel: rpcMethod(editParams, (p) => {
      store.edit(p.providerId, p.id, {
        ...(p.label !== undefined ? { label: p.label } : {}),
        ...(p.reasoning !== undefined ? { reasoning: p.reasoning } : {}),
      });
      return view();
    }),
    removeModel: rpcMethod(idParams, (p) => {
      store.remove(p.providerId, p.id);
      return view();
    }),
    setModelHidden: rpcMethod(hiddenParams, (p) => {
      store.setHidden(p.providerId, p.id, p.hidden);
      return view();
    }),
  };
}
