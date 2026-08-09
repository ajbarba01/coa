import { z } from 'zod';
import type { ModelMetadataCatalog } from '../models/metadata-catalog.js';
import { rpcMethod, type RpcHandlers } from './router.js';

/**
 * The model-metadata read verb — the console's query surface for per-model info
 * (context window, pricing, modalities, reasoning support): the context ring, the
 * model-picker hover card, and attach-control capability gating all read this. A
 * sync read over whatever {@link ModelMetadataCatalog.refresh} last resolved (static
 * fallback if a refresh never completed/succeeded) — this verb never itself blocks
 * on a network fetch.
 */
const paramsSchema = z.object({ provider: z.string().min(1).optional() }).optional();

export function buildModelMetadataHandlers(catalog: ModelMetadataCatalog): RpcHandlers {
  return {
    modelMetadata: rpcMethod(paramsSchema, (params) => ({
      entries: catalog.list(params?.provider),
    })),
  };
}
