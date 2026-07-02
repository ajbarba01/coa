/**
 * @coa/adapter-deepseek (M9 backend) — the thin DeepSeek `RuntimeAdapter`
 * (dual-backend spec Part C). Implements the `complete()` primitive over
 * DeepSeek's OpenAI-compatible HTTP API and drives the shared `@coa/loop-driver`;
 * everything else (tools, roles, context, the two SC-1 blocks) comes from coa.
 * Imports no provider SDK — just `fetch`.
 */

export { DeepSeekAdapter, type DeepSeekAdapterInit } from './adapter.js';
export {
  makeDeepSeekComplete,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  type DeepSeekCompleteConfig,
  type DeepSeekReasoning,
  type FetchLike,
} from './complete.js';
export {
  fetchDeepSeekModels,
  loadEffortCaps,
  toModelDescriptor,
  EFFORT_ENV_VAR,
  type EffortCaps,
  type FetchModelsConfig,
} from './models.js';
export {
  loadPriceTable,
  toRuntimeUsage,
  PRICES_ENV_VAR,
  type ModelPrice,
  type PriceTable,
} from './pricing.js';
export { resolveApiKey, DEFAULT_API_KEY_VAR } from './credentials.js';
export { renderSystemPrompt } from './render.js';
