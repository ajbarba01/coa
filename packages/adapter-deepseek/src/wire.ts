import { z } from 'zod';

/**
 * The DeepSeek chat-completions wire types (OpenAI-compatible). coa validates the
 * response at the edge (Zod-parse-before-touch); unknown fields are dropped, so a
 * DeepSeek API change that only adds fields never breaks the mapping. Request
 * shapes are plain builders (no validation needed — coa authors them).
 */

/** A tool call the model emitted (OpenAI function-call shape; `arguments` is a JSON string). */
export const wireToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function').optional(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
export type WireToolCall = z.infer<typeof wireToolCallSchema>;

export const wireMessageSchema = z.object({
  // `role` is echoed by the API but coa consumes only content/tool_calls, so it is optional.
  role: z.string().optional(),
  content: z.string().nullable().optional(),
  tool_calls: z.array(wireToolCallSchema).optional(),
});

export const wireChoiceSchema = z.object({
  message: wireMessageSchema,
  finish_reason: z.string().nullable().optional(),
});

/** DeepSeek's usage block — with its cache-hit/miss token split (prompt caching). */
export const wireUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  prompt_cache_hit_tokens: z.number().optional(),
  prompt_cache_miss_tokens: z.number().optional(),
});
export type WireUsage = z.infer<typeof wireUsageSchema>;

export const chatCompletionResponseSchema = z.object({
  choices: z.array(wireChoiceSchema).min(1),
  usage: wireUsageSchema.optional(),
});
export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;

/** The `/models` list response (OpenAI-compatible: `{ data: [{ id }] }`). */
export const modelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});
