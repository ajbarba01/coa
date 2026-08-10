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
export { dispatch, type RpcHandlers } from './rpc/router.js';
export {
  buildAgentRegistryHandlers,
  buildConsoleHandlers,
  buildRegistryHandlers,
} from './rpc/console-handlers.js';
export { buildAuthHandlers } from './rpc/auth-handlers.js';
export { buildModelHandlers, MODEL_PROVIDERS } from './rpc/model-handlers.js';
export { buildModelMetadataHandlers } from './rpc/model-metadata-handlers.js';
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
export { buildSessionHandlers, type SessionCapabilities } from './session/session-handlers.js';
export {
  SessionService,
  type SendRequest,
  type SessionServiceOptions,
  type StartChildRequest,
} from './session/session-service.js';
export { LiveSessionRegistry } from './session/live-registry.js';
export {
  WorktreeManager,
  type WorktreeRecord,
  type WorktreeStatus,
} from './session/worktree-manager.js';
export { buildConversationHandlers } from './session/conversation-handlers.js';
export { buildWorktreeHandlers, type WorktreeHandlerDeps } from './session/worktree-handlers.js';
export { ModelCache, type ModelCacheAccount } from './session/model-cache.js';
export { createConversationStore } from './session/conversation-store.js';
export { createMessageLog, SYSTEM_SENDER, type MessageLog } from './session/message-log.js';
export { createDaemonCore, type DaemonCoreHandle } from './session/daemon.js';
export { AccountsRegistry } from './auth/registry.js';
export { LoginManager } from './auth/login-manager.js';
export { BrowserSession } from './auth/browser-session.js';
export { ConsoleStateStore } from './console/console-state-store.js';
export { KeyStateStore } from './workbench/web/key-state-store.js';
export { ModelCatalogStore } from './models/model-catalog-store.js';
export { effectiveModels } from './models/effective-models.js';
export { ModelMetadataCatalog, modelMetadataCachePath } from './models/metadata-catalog.js';
export {
  WebConfigStore,
  webConfigPath,
  webKeyFilePath,
  SEARCH_KINDS,
  FETCH_KINDS,
  type WebChain,
} from './workbench/web/web-config-store.js';
export { buildWebToolDeps, webConfigSchema, type WebConfig } from './workbench/web/web-config.js';
export { makeSummarizer } from './workbench/web/summarizer.js';
export { type Summarizer, type WebToolDeps } from './workbench/web-tools.js';
export { classifyTool } from './workbench/tool-class.js';
export { type ModeDeps } from './session/permission.js';
export { DEFAULT_PERMISSION_MODE } from './session/live-session.js';
