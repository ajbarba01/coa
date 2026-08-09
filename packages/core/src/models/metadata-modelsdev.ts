import { z } from 'zod';
import type { ModelMetadata } from '@coa/shared';

/**
 * The models.dev catalog fetch — the cross-provider metadata base (context window,
 * max output, modalities, pricing, reasoning support), fetched off-critical-path and
 * merged over the static floor. `https://models.dev/api.json` is public, no-auth-
 * required, and shaped as `{ [providerId]: { models: { [modelId]: {...} } } }` —
 * verified live 2026-08-09 (a checked-in fixture-equivalent inline in the test file,
 * since the real payload is 3.6MB). Unknown fields are dropped at the edge (a payload
 * change that only adds fields never breaks the parse).
 */
const MODELS_DEV_URL = 'https://models.dev/api.json';

/** coa provider id → the models.dev provider key it corresponds to. A coa provider
 *  with no entry here (or no match on that provider) simply contributes nothing from
 *  this layer — never a throw, never a fabricated row. */
const PROVIDER_TO_MODELS_DEV: Record<string, string> = {
  claude: 'anthropic',
  deepseek: 'deepseek',
  longcat: 'longcat',
  openai: 'openai',
  openrouter: 'openrouter',
};

const modelsDevCostSchema = z.object({
  input: z.number().optional(),
  output: z.number().optional(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
});

const modelsDevModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  reasoning: z.boolean().optional(),
  modalities: z
    .object({ input: z.array(z.string()).optional(), output: z.array(z.string()).optional() })
    .optional(),
  open_weights: z.boolean().optional(),
  knowledge: z.string().optional(),
  limit: z.object({ context: z.number().optional(), output: z.number().optional() }).optional(),
  cost: modelsDevCostSchema.optional(),
});

const modelsDevProviderSchema = z.object({
  models: z.record(z.string(), modelsDevModelSchema),
});

/** The whole payload keyed by provider id; a provider row shaped unexpectedly is
 *  dropped rather than failing the entire parse (`catch` around the per-provider
 *  `safeParse`, see {@link parseModelsDevCatalog}). */
const modelsDevRawSchema = z.record(z.string(), z.unknown());

type ModelsDevModel = z.infer<typeof modelsDevModelSchema>;

function toMetadata(coaProvider: string, raw: ModelsDevModel): ModelMetadata {
  const modalities =
    raw.modalities !== undefined
      ? { input: raw.modalities.input ?? [], output: raw.modalities.output ?? [] }
      : undefined;
  const cost = raw.cost;
  const pricing =
    cost !== undefined
      ? {
          ...(cost.input !== undefined ? { inputPerMillion: cost.input } : {}),
          ...(cost.output !== undefined ? { outputPerMillion: cost.output } : {}),
          ...(cost.cache_read !== undefined ? { cacheReadPerMillion: cost.cache_read } : {}),
          ...(cost.cache_write !== undefined ? { cacheWritePerMillion: cost.cache_write } : {}),
        }
      : undefined;
  return {
    id: raw.id,
    provider: coaProvider,
    ...(raw.name !== undefined ? { displayName: raw.name } : {}),
    ...(raw.limit?.context !== undefined ? { contextWindow: raw.limit.context } : {}),
    ...(raw.limit?.output !== undefined ? { maxOutputTokens: raw.limit.output } : {}),
    ...(modalities !== undefined ? { modalities } : {}),
    ...(pricing !== undefined && Object.keys(pricing).length > 0 ? { pricing } : {}),
    ...(raw.reasoning !== undefined ? { reasoning: raw.reasoning } : {}),
    ...(raw.open_weights !== undefined ? { openWeights: raw.open_weights } : {}),
    ...(raw.knowledge !== undefined ? { knowledgeCutoff: raw.knowledge } : {}),
    source: 'models-dev',
  };
}

/**
 * Parse the raw models.dev payload into coa's neutral rows, for every coa provider
 * {@link PROVIDER_TO_MODELS_DEV} maps. Never throws: a provider whose shape doesn't
 * parse (or that models.dev doesn't carry) simply contributes no rows.
 */
export function parseModelsDevCatalog(raw: unknown): ModelMetadata[] {
  const top = modelsDevRawSchema.safeParse(raw);
  if (!top.success) return [];
  const out: ModelMetadata[] = [];
  for (const [coaProvider, devKey] of Object.entries(PROVIDER_TO_MODELS_DEV)) {
    const providerRaw = top.data[devKey];
    if (providerRaw === undefined) continue;
    const parsed = modelsDevProviderSchema.safeParse(providerRaw);
    if (!parsed.success) continue;
    for (const model of Object.values(parsed.data.models)) {
      out.push(toMetadata(coaProvider, model));
    }
  }
  return out;
}

export interface FetchModelsDevConfig {
  fetchImpl?: typeof fetch;
  url?: string;
}

/**
 * Fetch + parse the models.dev catalog. Never throws — a network failure or a
 * non-OK response resolves to `undefined` (distinct from a genuinely-empty parse,
 * `[]`), so a caching caller can tell "this attempt failed, keep what you had" from
 * "this attempt succeeded and found nothing" and never lets a transient failure wipe
 * a good cache.
 */
export async function fetchModelsDevCatalog(
  config: FetchModelsDevConfig = {},
): Promise<ModelMetadata[] | undefined> {
  const doFetch = config.fetchImpl ?? fetch;
  try {
    const res = await doFetch(config.url ?? MODELS_DEV_URL);
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    return parseModelsDevCatalog(body);
  } catch {
    return undefined;
  }
}
