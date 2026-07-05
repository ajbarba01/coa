/**
 * @coa/adapter-longcat (M9 backend) — the thin LongCat `RuntimeAdapter`. Implements the
 * `complete()` primitive over LongCat's OpenAI-compatible HTTP API and drives the shared
 * `@coa/loop-driver`; everything else (tools, roles, context, the two SC-1 blocks) comes
 * from coa. Imports no provider SDK — just `fetch`.
 */

export { LongCatAdapter, type LongCatAdapterInit } from './adapter.js';
export {
  makeLongCatComplete,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  type LongCatCompleteConfig,
  type LongCatReasoning,
  type FetchLike,
} from './complete.js';
export {
  fetchLongCatModels,
  loadEffortCaps,
  toModelDescriptor,
  DEFAULT_MODELS_URL,
  EFFORT_ENV_VAR,
  type EffortCaps,
  type FetchModelsConfig,
} from './models.js';
export {
  loadPriceTable,
  toRuntimeUsage,
  DEFAULT_PRICES,
  PRICES_ENV_VAR,
  type ModelPrice,
  type PriceTable,
} from './pricing.js';
export { resolveApiKey, DEFAULT_API_KEY_VAR } from './credentials.js';
export { renderSystemPrompt } from './render.js';
