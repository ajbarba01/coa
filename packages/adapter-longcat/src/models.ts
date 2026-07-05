import { z } from 'zod';
import type { ClaudeEffort, ModelDescriptor } from '@coa/shared';
import { modelsResponseSchema } from './wire.js';
import { type FetchLike } from './complete.js';

/**
 * Backend model discovery for LongCat. The model list is fetched live from the
 * OpenAI-compatible list endpoint (`/openai/v1/models`, verified against the live API —
 * the docs' `/v1/models` 404s), so the account's real models appear without a code change.
 * The models URL is kept as its own constant (rather than derived from the chat base) so a
 * future path divergence is a one-line change. `LongCat-2.0` exposes a thinking toggle, not
 * a graded effort ladder, so per-model effort levels come from a config-overridable map
 * (`COA_LONGCAT_EFFORT`, JSON) that ships empty; a model absent from it exposes no effort control.
 */

export const DEFAULT_MODELS_URL = 'https://api.longcat.chat/openai/v1/models';
export const EFFORT_ENV_VAR = 'COA_LONGCAT_EFFORT';

/** `{ "LongCat-3.0": ["high","max"] }` — per-model supported effort levels (coa's ladder). */
export const effortCapsSchema = z.record(
  z.string(),
  z.array(z.enum(['low', 'medium', 'high', 'xhigh', 'max'])),
);
export type EffortCaps = z.infer<typeof effortCapsSchema>;

/** LongCat-2.0 has no effort ladder (thinking on/off only), so the shipped defaults are empty. */
export const DEFAULT_EFFORT_CAPS: EffortCaps = {};

/** Load the per-model effort ladders: the empty defaults, with the config env var overriding per model. */
export function loadEffortCaps(env: Record<string, string | undefined> = process.env): EffortCaps {
  const raw = env[EFFORT_ENV_VAR];
  if (raw === undefined || raw === '') return { ...DEFAULT_EFFORT_CAPS };
  try {
    return { ...DEFAULT_EFFORT_CAPS, ...effortCapsSchema.parse(JSON.parse(raw)) };
  } catch {
    return { ...DEFAULT_EFFORT_CAPS };
  }
}

/** Map a LongCat model id + its configured effort ladder to the neutral descriptor. */
export function toModelDescriptor(id: string, caps: EffortCaps): ModelDescriptor {
  const levels = caps[id];
  if (levels === undefined || levels.length === 0) return { id };
  return { id, supportsEffort: true, supportedEffortLevels: levels as ClaudeEffort[] };
}

export interface FetchModelsConfig {
  apiKey: string;
  modelsUrl?: string;
  caps?: EffortCaps;
  fetchImpl?: FetchLike;
}

/**
 * Fetch the account's LongCat models (+ configured effort ladders). A non-OK response
 * THROWS (a failed fetch must never be mistaken for a genuinely-empty model list — the
 * model cache only stores a resolved fetch, so a throw self-heals on the next call).
 */
export async function fetchLongCatModels(config: FetchModelsConfig): Promise<ModelDescriptor[]> {
  const url = config.modelsUrl ?? DEFAULT_MODELS_URL;
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const caps = config.caps ?? {};
  const res = await doFetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(
      `longcat /models failed: HTTP ${res.status}${snippet !== '' ? ` — ${snippet}` : ''}`,
    );
  }
  const parsed = modelsResponseSchema.parse(await res.json());
  return parsed.data.map((model) => toModelDescriptor(model.id, caps));
}
