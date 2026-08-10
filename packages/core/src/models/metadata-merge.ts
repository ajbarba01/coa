import type { ModelMetadata } from '@coa/shared';

/**
 * The fallback-chain merge: static < models.dev < OpenRouter-live, later layers
 * overriding only the fields they actually carry (never a wholesale replace) — a
 * live source without a `displayName` must not blank out the static floor's label.
 * Keyed by `${provider}:${id}` so `openrouter:anthropic/claude-sonnet-4.5` and
 * `claude:claude-sonnet-5` stay distinct rows even though they name the same
 * underlying model. `pricing` merges per-sub-field (a later layer's partial pricing
 * object enriches, not erases, an earlier layer's fuller one); `modalities` replaces
 * wholesale when a layer supplies it (a partial modality list has no honest merge).
 */
function key(entry: Pick<ModelMetadata, 'provider' | 'id'>): string {
  return `${entry.provider}:${entry.id}`;
}

function mergeOne(prior: ModelMetadata | undefined, next: ModelMetadata): ModelMetadata {
  if (prior === undefined) return next;
  const merged: ModelMetadata = { ...prior, ...next };
  if (prior.pricing !== undefined || next.pricing !== undefined) {
    merged.pricing = { ...prior.pricing, ...next.pricing };
  }
  return merged;
}

/** Merge metadata layers in fallback-chain order (earliest = lowest priority). Pure. */
export function mergeModelMetadata(...layers: readonly ModelMetadata[][]): ModelMetadata[] {
  const byKey = new Map<string, ModelMetadata>();
  for (const layer of layers) {
    for (const entry of layer) {
      byKey.set(key(entry), mergeOne(byKey.get(key(entry)), entry));
    }
  }
  return [...byKey.values()];
}
