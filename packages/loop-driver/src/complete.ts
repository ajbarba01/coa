import type { BackendMessage, LoopToolCall } from '@coa/shared';
import type { RuntimeUsage } from '@coa/spi';

/**
 * The `complete()` primitive (dual-backend spec C1) — the ONE backend-specific
 * surface a pure chat-completions API must implement. It is a single model
 * round-trip (no loop, no governance): given the running conversation + the
 * available tools, return the model's text, any tool calls it wants, and the
 * settled usage. All the agentic scaffolding (tool execution, the two SC-1
 * blocks, TurnFrame mapping) lives in the coa loop driver, so adding another pure
 * API stays trivial — implement `complete()` and nothing else.
 *
 * These are neutral shapes: no provider (DeepSeek/OpenAI/…) type leaks across the
 * seam, and no coa type leaks provider-ward — the adapter maps its wire format to
 * these on the way in.
 */

/**
 * A message in the driver's running conversation (the neutral M0 chat-transcript
 * record). Re-exported under the driver's local name; it is the same shape the R-7
 * store persists so the transcript round-trips verbatim across turns.
 */
export type DriverMessage = BackendMessage;
export type { LoopToolCall };

/** A tool offered to the model — coa-authored name/description + its JSON-schema parameters. */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON-schema-shaped parameters (from the governed tool's Zod input); opaque to the driver. */
  parameters: unknown;
}

/** The pure model round-trip result: text + any tool calls + settled usage. */
export interface CompletionResult {
  text: string;
  toolCalls: LoopToolCall[];
  usage: RuntimeUsage;
  /**
   * The model's reasoning ("thinking") output when the backend exposes it separately
   * from `text` (e.g. DeepSeek/LongCat `reasoning_content`). Display-only — the driver
   * emits it as a thinking frame but never resends it to the API. Absent ⇒ no thinking.
   */
  reasoning?: string | undefined;
}

/**
 * One streaming chunk from a model round-trip (Piece B / G7): an incremental piece of
 * answer `text` or of the reasoning ("thinking") channel. Neutral — the driver maps a
 * delta to a `text-delta`/`thinking-delta` TurnFrame; no frame vocabulary crosses this
 * seam. Delivery-only: deltas are pushed to the UI, never persisted (docs/adr/0013).
 */
export type CompletionDelta =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string };

/**
 * The streaming `complete()` primitive: one model round-trip as an async-iterable of
 * text/reasoning deltas TERMINATING IN the settled {@link CompletionResult} (the
 * generator's return value). A non-streaming backend degrades to yielding nothing and
 * returning the whole result — byte-identical to a single-block turn (D85).
 */
export type CompleteFn = (
  messages: readonly DriverMessage[],
  tools: readonly ToolDef[],
  signal?: AbortSignal,
) => AsyncGenerator<CompletionDelta, CompletionResult>;
