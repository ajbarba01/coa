import { z } from 'zod';
import type { ClaudeEffort, ModelDescriptor } from '@coa/shared';
import { modelsResponseSchema } from './wire.js';
import { DEFAULT_BASE_URL, type FetchLike } from './complete.js';

/**
 * Backend model discovery for DeepSeek (spec C5). The model list is fetched live
 * from the OpenAI-compatible `/models` endpoint, so the account's real models
 * (incl. newer ones) appear without a code change. That endpoint reports no
 * reasoning capabilities, so per-model effort ladders come from a
 * **config-overridable capability map** (`COA_DEEPSEEK_EFFORT`, JSON) — the same
 * data-driven posture as pricing. Verified levels can be plugged in there without
 * touching code; a model absent from the map exposes no effort control.
 */

export const EFFORT_ENV_VAR = 'COA_DEEPSEEK_EFFORT';

/** `{ "deepseek-v4-pro": ["high","max"] }` — per-model supported effort levels (coa's ladder). */
export const effortCapsSchema = z.record(
  z.string(),
  z.array(z.enum(['low', 'medium', 'high', 'xhigh', 'max'])),
);
export type EffortCaps = z.infer<typeof effortCapsSchema>;

/**
 * The V4 effort ladders coa ships by default (from the official docs: `reasoning_effort`
 * is `high`/`max`, non-thinking is a separate `off`). Overridable per model via
 * {@link EFFORT_ENV_VAR}; other models expose no effort unless configured.
 */
export const DEFAULT_EFFORT_CAPS: EffortCaps = {
  'deepseek-v4-pro': ['high', 'max'],
  'deepseek-v4-flash': ['high', 'max'],
};

/** Load the per-model effort ladders: the shipped V4 defaults, with the config env var overriding per model. */
export function loadEffortCaps(env: Record<string, string | undefined> = process.env): EffortCaps {
  const raw = env[EFFORT_ENV_VAR];
  if (raw === undefined || raw === '') return { ...DEFAULT_EFFORT_CAPS };
  try {
    return { ...DEFAULT_EFFORT_CAPS, ...effortCapsSchema.parse(JSON.parse(raw)) };
  } catch {
    return { ...DEFAULT_EFFORT_CAPS };
  }
}

/** Map a DeepSeek model id + its configured effort ladder to the neutral descriptor. */
export function toModelDescriptor(id: string, caps: EffortCaps): ModelDescriptor {
  const levels = caps[id];
  if (levels === undefined || levels.length === 0) return { id };
  return { id, supportsEffort: true, supportedEffortLevels: levels as ClaudeEffort[] };
}

export interface FetchModelsConfig {
  apiKey: string;
  baseUrl?: string;
  caps?: EffortCaps;
  fetchImpl?: FetchLike;
}

/**
 * Fetch the account's DeepSeek models (+ configured effort ladders). A non-OK
 * response THROWS (a failed fetch must never be mistaken for a genuinely-empty
 * model list — see {@link ModelCache}, which only caches a resolved fetch, so a
 * throw here self-heals on the next call instead of poisoning the cache forever).
 */
export async function fetchDeepSeekModels(config: FetchModelsConfig): Promise<ModelDescriptor[]> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const caps = config.caps ?? {};
  const res = await doFetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: { authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(
      `deepseek /models failed: HTTP ${res.status}${snippet !== '' ? ` — ${snippet}` : ''}`,
    );
  }
  const parsed = modelsResponseSchema.parse(await res.json());
  return parsed.data.map((model) => toModelDescriptor(model.id, caps));
}
