import type { ClaudeEffort, ModelDescriptor } from '@coa/shared';
import { modelsResponseSchema } from './wire.js';
import type { FetchLike } from './complete.js';
import type { EffortCaps, ProviderSpec } from './provider-spec.js';

/**
 * Backend model discovery. The model list is fetched live from the provider's
 * OpenAI-compatible list endpoint, so the account's real models (incl. newer ones)
 * appear without a code change. That endpoint reports no reasoning capabilities, so
 * per-model effort ladders come from the spec's config-overridable capability map —
 * the same data-driven posture as pricing. Verified levels can be plugged in there
 * without touching code; a model absent from the map exposes no effort control
 * (or, for a spec with a thinking toggle, the binary on/off control).
 */

/**
 * Map a model id + its configured effort ladder to the neutral descriptor. With a
 * configured ladder the model exposes graded effort; without one it exposes the
 * spec's thinking on/off toggle when the provider has one (surfaced as an On/Off
 * control — not "no reasoning"), or no reasoning control at all.
 */
export function toModelDescriptor(
  spec: ProviderSpec,
  id: string,
  caps: EffortCaps,
): ModelDescriptor {
  const levels = caps[id];
  if (levels === undefined || levels.length === 0) {
    return spec.thinkingToggle ? { id, supportsThinking: true } : { id };
  }
  return { id, supportsEffort: true, supportedEffortLevels: levels as ClaudeEffort[] };
}

export interface FetchModelsConfig {
  apiKey: string;
  /** Override the spec's model-list endpoint (tests / self-hosted gateways). */
  modelsUrl?: string;
  caps?: EffortCaps;
  fetchImpl?: FetchLike;
}

/**
 * Fetch the account's models (+ configured effort ladders). A non-OK response
 * THROWS (a failed fetch must never be mistaken for a genuinely-empty model list —
 * the model cache only stores a resolved fetch, so a throw here self-heals on the
 * next call instead of poisoning the cache forever).
 */
export async function fetchOpenAiCompatModels(
  spec: ProviderSpec,
  config: FetchModelsConfig,
): Promise<ModelDescriptor[]> {
  const url = config.modelsUrl ?? spec.modelsUrl ?? `${spec.baseUrl}/models`;
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const caps = config.caps ?? {};
  const res = await doFetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(
      `${spec.id} /models failed: HTTP ${res.status}${snippet !== '' ? ` — ${snippet}` : ''}`,
    );
  }
  const parsed = modelsResponseSchema.parse(await res.json());
  return parsed.data.map((model) => toModelDescriptor(spec, model.id, caps));
}
