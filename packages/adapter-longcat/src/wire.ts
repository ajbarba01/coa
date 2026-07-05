import { z } from 'zod';

/**
 * The LongCat chat-completions wire types (OpenAI-compatible). coa validates the
 * response at the edge (Zod-parse-before-touch); unknown fields are dropped, so a
 * LongCat API change that only adds fields never breaks the mapping. Request shapes
 * are plain builders (no validation needed — coa authors them).
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
  // LongCat surfaces thinking as `reasoning_content`; coa consumes `content` only (dropped).
  tool_calls: z.array(wireToolCallSchema).optional(),
});

export const wireChoiceSchema = z.object({
  message: wireMessageSchema,
  finish_reason: z.string().nullable().optional(),
});

/**
 * LongCat's usage block. Cache-hit tokens follow the OpenAI-standard nested shape
 * `prompt_tokens_details.cached_tokens` (not DeepSeek's flat `prompt_cache_hit_tokens`).
 * The exact field is confirmed by the Task 9 live smoke; a wrong guess drops to
 * zero-cost here (parse-and-drop), never a crash.
 */
export const wireUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  prompt_tokens_details: z.object({ cached_tokens: z.number() }).optional(),
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
