/**
 * @coa/core — the Change Kernel: the narrow waist and only shared mutable
 * substrate. Producers and consumers point only here. This barrel is the
 * package's public surface: exactly the composition/daemon/CLI seams the
 * shippable apps consume. Everything else in the package is internal and
 * composed through relative imports (tests included — they import internals
 * directly by repo policy).
 */

export { type ChangeEventDraft } from './event.js';
export { type Producer } from './flags/producer.js';
export { listen, defaultDaemonPath, type RpcServer } from './rpc/transport.js';
export { connectClient } from './rpc/client.js';
export { bindDaemon } from './rpc/lifecycle.js';
export { buildAgentRegistryHandlers, buildRegistryHandlers } from './rpc/console-handlers.js';
export { buildModelHandlers, MODEL_PROVIDERS } from './rpc/model-handlers.js';
export { loadGenerateFile } from './context/generate-config.js';
export { createGenerationRunner, type GenerationIo } from './context/generation-runner.js';
export { assembleProducers } from './context/producers.js';
export {
  type SessionDeps,
  type SessionAdapterInit,
  type SessionStrategy,
  type ActiveAccountResolution,
} from './session/session.js';
export { createRegistryAssemblePieces } from './session/assemble-agent.js';
export { resolveShell, shellLabel } from './session/shell.js';
export {
  packageRegistry,
  roleRegistry,
  roleSummaries,
  packageSummaries,
} from './session/agent-registry.js';
export { AgentRegistry } from './session/agent-defs.js';
export { composeSessionDeps, type SessionWiring } from './session/composition.js';
export { buildSessionHandlers, type StartChildFn } from './session/session-handlers.js';
export { LiveSessionRegistry } from './session/live-registry.js';
export { buildConversationHandlers } from './session/conversation-handlers.js';
export { ModelCache, type ModelCacheAccount } from './session/model-cache.js';
export { createConversationStore } from './session/conversation-store.js';
export {
  createDaemonCore,
  buildDaemonConsoleHandlers,
  type DaemonConsoleDeps,
  type DaemonCoreHandle,
} from './session/daemon.js';
export { AccountsRegistry } from './auth/registry.js';
export { ModelCatalogStore } from './models/model-catalog-store.js';
export { effectiveModels } from './models/effective-models.js';
export {
  WebConfigStore,
  webConfigPath,
  webKeyFilePath,
  SEARCH_KINDS,
  FETCH_KINDS,
  type WebChain,
} from './workbench/web/web-config-store.js';
export { webConfigSchema, type WebConfig } from './workbench/web/web-config.js';
export { makeSummarizer } from './workbench/web/summarizer.js';
export { type Summarizer } from './workbench/web-tools.js';
