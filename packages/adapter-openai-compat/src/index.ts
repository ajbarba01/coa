/**
 * @coa/adapter-openai-compat — the thin OpenAI-compatible `RuntimeAdapter` behind
 * the backend port: ONE code path (request build, SSE streaming, pricing,
 * credentials, model discovery) implementing the `complete()` primitive over HTTP
 * and driving the shared `@coa/loop-driver`, parameterized by a {@link ProviderSpec}.
 * DeepSeek and LongCat ship as spec objects; everything else (tools, roles, context,
 * the close-gate and cost-cap blocks) comes from coa. Imports no provider SDK —
 * just `fetch`.
 */

export { OpenAiCompatAdapter, type OpenAiCompatAdapterInit } from './adapter.js';
export { makeOpenAiCompatComplete, type CompleteConfig, type FetchLike } from './complete.js';
export { fetchOpenAiCompatModels, toModelDescriptor, type FetchModelsConfig } from './models.js';
export { toRuntimeUsage } from './pricing.js';
export { resolveApiKey, type ReadKeyFile } from './credentials.js';
export { renderSystemPrompt } from './render.js';
export {
  loadEffortCaps,
  loadPriceTable,
  type EffortCaps,
  type ModelPrice,
  type NormalizedUsage,
  type PriceTable,
  type ProviderSpec,
} from './provider-spec.js';
export { deepseekSpec } from './deepseek.js';
export { longcatSpec } from './longcat.js';
