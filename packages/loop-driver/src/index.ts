/**
 * @coa/loop-driver — the coa-owned governed ReAct loop for pure-API backends.
 * A thin chat-completions adapter (DeepSeek, or any
 * OpenAI-compatible API) implements only the {@link CompleteFn} primitive; this
 * package drives the loop, applies the system's only two blocks (the close-gate
 * and the cost-cap), executes every governed
 * tool, and maps each step to a neutral TurnFrame. Backend-neutral: it
 * imports only `@coa/shared` + `@coa/spi`, no provider SDK.
 */

export type {
  CompleteFn,
  CompletionDelta,
  CompletionResult,
  DriverMessage,
  ToolDef,
} from './complete.js';
export { runGovernedLoop } from './driver.js';
