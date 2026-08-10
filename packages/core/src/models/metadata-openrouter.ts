import { z } from 'zod';
import type { ModelMetadata } from '@coa/shared';

/**
 * OpenRouter's live `/models` catalog — the most-current source for OpenRouter-routed
 * models specifically (it reflects vendor pricing/availability changes faster than
 * models.dev's periodically-rebuilt snapshot). Public, no-auth-required. Row shape
 * verified live 2026-08-09 (and against the checked-in fixture
 * `adapter-openai-compat/src/openrouter-models.fixture.json`, which this module's
 * test also parses to stay honest about the real payload). This module intentionally
 * does NOT import `@coa/adapter-openai-compat` (core does not depend on any adapter
 * package — REPO_LAYOUT's `backend-fan-in-is-injected` rule) — its own copy of the
 * wire schema is a deliberate, narrow duplication, not drift risk (the two schemas
 * serve different needs: that package only ever wants `id`).
 */
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const openrouterArchitectureSchema = z.object({
  input_modalities: z.array(z.string()).optional(),
  output_modalities: z.array(z.string()).optional(),
});

const openrouterPricingSchema = z.object({
  // Decimal-string USD-per-TOKEN rates (OpenRouter's own wire convention) — converted
  // to per-million in `toMetadata` to match this catalog's neutral unit.
  prompt: z.string().optional(),
  completion: z.string().optional(),
  input_cache_read: z.string().optional(),
  input_cache_write: z.string().optional(),
});

const openrouterTopProviderSchema = z.object({
  max_completion_tokens: z.number().nullish(),
});

const openrouterModelRowSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  context_length: z.number().optional(),
  architecture: openrouterArchitectureSchema.optional(),
  pricing: openrouterPricingSchema.optional(),
  top_provider: openrouterTopProviderSchema.optional(),
});

const openrouterModelsResponseSchema = z.object({ data: z.array(openrouterModelRowSchema) });

type OpenRouterModelRow = z.infer<typeof openrouterModelRowSchema>;

/** Parse an OpenRouter decimal-string per-token rate to USD-per-million; a missing or
 *  unparseable rate contributes no field (never a fabricated 0). */
function perMillion(rate: string | undefined): number | undefined {
  if (rate === undefined) return undefined;
  const n = Number(rate);
  return Number.isFinite(n) ? n * 1_000_000 : undefined;
}

function toMetadata(row: OpenRouterModelRow): ModelMetadata {
  const inputPerMillion = perMillion(row.pricing?.prompt);
  const outputPerMillion = perMillion(row.pricing?.completion);
  const cacheReadPerMillion = perMillion(row.pricing?.input_cache_read);
  const cacheWritePerMillion = perMillion(row.pricing?.input_cache_write);
  const pricing =
    inputPerMillion !== undefined ||
    outputPerMillion !== undefined ||
    cacheReadPerMillion !== undefined ||
    cacheWritePerMillion !== undefined
      ? {
          ...(inputPerMillion !== undefined ? { inputPerMillion } : {}),
          ...(outputPerMillion !== undefined ? { outputPerMillion } : {}),
          ...(cacheReadPerMillion !== undefined ? { cacheReadPerMillion } : {}),
          ...(cacheWritePerMillion !== undefined ? { cacheWritePerMillion } : {}),
        }
      : undefined;
  const modalities =
    row.architecture?.input_modalities !== undefined ||
    row.architecture?.output_modalities !== undefined
      ? {
          input: row.architecture?.input_modalities ?? [],
          output: row.architecture?.output_modalities ?? [],
        }
      : undefined;
  return {
    id: row.id,
    provider: 'openrouter',
    ...(row.name !== undefined ? { displayName: row.name } : {}),
    ...(row.context_length !== undefined ? { contextWindow: row.context_length } : {}),
    ...(row.top_provider?.max_completion_tokens != null
      ? { maxOutputTokens: row.top_provider.max_completion_tokens }
      : {}),
    ...(modalities !== undefined ? { modalities } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
    source: 'openrouter',
  };
}

/** Parse OpenRouter's raw `/models` response into coa's neutral rows, every row
 *  filed under the `openrouter` provider (the routed id, e.g. `anthropic/claude-sonnet-4.5`,
 *  IS the model id in this namespace). Never throws: an unparseable payload yields `[]`. */
export function parseOpenRouterCatalog(raw: unknown): ModelMetadata[] {
  const parsed = openrouterModelsResponseSchema.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.data.map(toMetadata);
}

export interface FetchOpenRouterConfig {
  fetchImpl?: typeof fetch;
  url?: string;
}

/**
 * Fetch + parse OpenRouter's live model list. Never throws — a network failure, a
 * non-OK response, OR a 200 response that parses to zero rows all resolve to
 * `undefined`, never `[]`: OpenRouter's `/models` catalog is never genuinely empty in
 * practice, so a zero-row parse despite a 200 is always a shape mismatch, an
 * error/notice body, or an outage dressed as 200 — treated as a failed attempt, the
 * same as a non-OK response or a thrown fetch. This lets a caching caller tell "this
 * attempt failed, keep what you had" from "this attempt succeeded and found real
 * rows", so a malformed-but-200 response can never wipe a good cache.
 */
export async function fetchOpenRouterCatalog(
  config: FetchOpenRouterConfig = {},
): Promise<ModelMetadata[] | undefined> {
  const doFetch = config.fetchImpl ?? fetch;
  try {
    const res = await doFetch(config.url ?? OPENROUTER_MODELS_URL);
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    const rows = parseOpenRouterCatalog(body);
    return rows.length > 0 ? rows : undefined;
  } catch {
    return undefined;
  }
}
