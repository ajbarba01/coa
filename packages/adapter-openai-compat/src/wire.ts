import { z } from 'zod';

/**
 * The OpenAI-compatible chat-completions wire types, shared by every provider spec.
 * coa validates the response at the edge (Zod-parse-before-touch); unknown fields are
 * dropped, so a provider API change that only adds fields never breaks the mapping.
 * Request shapes are plain builders (no validation needed — coa authors them).
 *
 * Where real providers disagree on a field's shape, this schema is the permissive
 * SUPERSET of every shape seen live, and the per-provider `ProviderSpec.extractUsage`
 * picks out its own. A field a provider never sends simply parses absent.
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
  // The model's separate reasoning ("thinking") output, present only when thinking is enabled.
  reasoning_content: z.string().nullable().optional(),
  tool_calls: z.array(wireToolCallSchema).optional(),
});

export const wireChoiceSchema = z.object({
  message: wireMessageSchema,
  finish_reason: z.string().nullable().optional(),
});

/**
 * The usage block — the superset of both cache-token shapes seen live: DeepSeek reports
 * its prompt-cache split FLAT (`prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`);
 * LongCat follows the OpenAI-standard NESTED shape (`prompt_tokens_details.cached_tokens`).
 * Everything here beyond the two base counts is optional, so a shape a provider never
 * sends costs nothing — a wrong guess drops to zero-cost (parse-and-drop), never a crash.
 */
export const wireUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  prompt_cache_hit_tokens: z.number().optional(),
  prompt_cache_miss_tokens: z.number().optional(),
  prompt_tokens_details: z.object({ cached_tokens: z.number().optional() }).optional(),
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

/**
 * One OpenAI-compatible streaming chunk (`chat.completion.chunk`): a partial `delta`
 * carrying incremental content/reasoning text and tool-call fragments (accumulated by
 * `index`), plus the usage block on the final chunk (`stream_options.include_usage`).
 */
export const streamDeltaSchema = z.object({
  content: z.string().nullable().optional(),
  reasoning_content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        index: z.number(),
        // `nullish`, NOT `optional` — the same null-vs-undefined trap as `usage` below, and
        // for the same reason. LongCat (live-verified) streams a tool call as fragments and
        // sets the already-known fields to NULL on the continuations (`id: null`,
        // `name: null`) rather than omitting them. `.optional()` admits `undefined` but not
        // `null`, so a null-blind schema fails the whole chunk's parse — and an unparseable
        // chunk is DROPPED in `complete.ts` — discarding every fragment that carried the
        // `arguments`. The call then arrives NAMED but with EMPTY arguments, and the
        // governed tool rejects it as `invalid-args`, blaming the model for the adapter's
        // own data loss. Providers that omit the fields instead parse identically.
        id: z.string().nullish(),
        function: z
          .object({ name: z.string().nullish(), arguments: z.string().nullish() })
          .optional(),
      }),
    )
    .optional(),
});
export const streamChunkSchema = z.object({
  choices: z.array(z.object({ delta: streamDeltaSchema.optional() })),
  // OpenAI-compatible streams send `usage: null` on EVERY chunk until the final one —
  // accept null, or a null-blind `.optional()` fails the whole chunk's parse and drops its text.
  usage: wireUsageSchema.nullish(),
});
