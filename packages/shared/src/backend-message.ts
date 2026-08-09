import { z } from 'zod';
import { attachmentSchema } from './attachment.js';

/**
 * The neutral chat-transcript record for a pure-API backend's conversation memory
 * (the dual-backend counterpart to a server-session id). A server-session backend
 * (the Claude Agent SDK) resumes its memory by session id; a pure chat-completions
 * backend (DeepSeek/OpenAI-shaped) has no server session, so coa persists the whole
 * message array itself and resends it verbatim each turn — the industry-standard
 * way to give the model continuity AND to keep the provider's prefix/KV context
 * cache warm (the cache hits only on an identical leading prefix, so nothing may be
 * dropped or reordered).
 *
 * This package owns the record; the loop driver produces it and the conversation store
 * persists it (separately from the lossy UI `TurnFrame` stream, which keeps only a
 * tool-result pointer — not the full output the model saw).
 */

/** One tool call the model emitted, correlated back to its result by `id`. */
export const loopToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});
export type LoopToolCall = z.infer<typeof loopToolCallSchema>;

/** A single message in a pure-API backend's running conversation. */
export const backendMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  /** On an assistant message: the tool calls it emitted (so the transcript round-trips). */
  toolCalls: z.array(loopToolCallSchema).optional(),
  /** On a `tool` message: which assistant tool call this result answers. */
  toolCallId: z.string().optional(),
  /**
   * Attachments the user (rarely: a tool result) added to this message — the ONE
   * shape every adapter maps to its own wire format (see {@link attachmentSchema}).
   * Absent ⇒ no attachments, byte-identical to today.
   */
  attachments: z.array(attachmentSchema).optional(),
});
export type BackendMessage = z.infer<typeof backendMessageSchema>;
