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

/** A message in the driver's running conversation (neutral chat shape). */
export interface DriverMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** On an assistant message: the tool calls it emitted (so the transcript round-trips). */
  toolCalls?: LoopToolCall[];
  /** On a `tool` message: which assistant tool call this result answers. */
  toolCallId?: string;
}

/** A tool offered to the model — coa-authored name/description + its JSON-schema parameters. */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON-schema-shaped parameters (from the governed tool's Zod input); opaque to the driver. */
  parameters: unknown;
}

/** One tool call the model emitted in a completion. */
export interface LoopToolCall {
  /** Provider-assigned call id, used to correlate the tool result back. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** The pure model round-trip result: text + any tool calls + settled usage. */
export interface CompletionResult {
  text: string;
  toolCalls: LoopToolCall[];
  usage: RuntimeUsage;
}

/** The `complete()` primitive: one model round-trip, mapped to neutral shapes. */
export type CompleteFn = (
  messages: readonly DriverMessage[],
  tools: readonly ToolDef[],
) => Promise<CompletionResult>;
