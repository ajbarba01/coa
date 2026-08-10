/**
 * @coa/loop-driver — the coa-owned governed ReAct loop for pure-API backends.
 * A thin chat-completions adapter (DeepSeek, or any
 * OpenAI-compatible API) implements only the {@link CompleteFn} primitive; this
 * package drives the loop, applies the governed predicates (the close-gate
 * block and the per-tool deny rules), executes every governed
 * tool, and maps each step to a neutral TurnFrame. Backend-neutral: it
 * imports only `@coa/shared` + `@coa/spi`, no provider SDK.
 */

// The `complete()` primitive's neutral shapes live with the other capability-port
// types in `@coa/spi`; re-exported here because they are this package's contract
// surface (implement `complete()`, hand it to the driver).
export type {
  CompleteFn,
  CompletionDelta,
  CompletionResult,
  DriverMessage,
  ToolDef,
} from '@coa/spi';
export { runGovernedLoop } from './driver.js';
