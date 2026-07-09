/**
 * @coa/loop-driver — the coa-owned governed ReAct loop for pure-API backends
 * (dual-backend spec Part C). A thin chat-completions adapter (DeepSeek, or any
 * OpenAI-compatible API) implements only the {@link CompleteFn} primitive; this
 * package drives the loop, applies the two SC-1 blocks, executes every governed
 * tool, and maps each step to a neutral {@link TurnFrame}. Backend-neutral: it
 * imports only `@coa/shared` + `@coa/spi`, no provider SDK.
 */

export type {
  CompleteFn,
  CompletionDelta,
  CompletionResult,
  DriverMessage,
  LoopToolCall,
  ToolDef,
} from './complete.js';
export {
  runGovernedLoop,
  toToolDefs,
  DEFAULT_MAX_ITERATIONS,
  type GovernedLoopDeps,
} from './driver.js';
