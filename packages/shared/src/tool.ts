import { z } from 'zod';
import type { InjectionBundle } from './flag.js';
import { diffSpecSchema } from './patch.js';

/**
 * The tool-boundary wire types (D127 schema half). The wire *policy* over this
 * grammar is M8's and the human-facing verb grammar is M10's; M0 owns the types.
 */

/** A reference to a symbol — by name, or by path (optionally a symbol within it). */
export const symbolRefSchema = z.union([
  z.object({ name: z.string() }),
  z.object({ path: z.string(), symbol: z.string().optional() }),
]);
export type SymbolRef = z.infer<typeof symbolRefSchema>;

/** A bounded slice of bytes returned to the agent, with the truncation point recorded. */
export const contextSliceSchema = z.object({
  ref: symbolRefSchema,
  bytes: z.string(),
  truncatedTo: z.number(),
});
export type ContextSlice = z.infer<typeof contextSliceSchema>;

export const toolCallSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  ref: symbolRefSchema.optional(),
  sessionId: z.string(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

/** The governed tool surface the loop calls (the representative v1 set; the real catalogue is M6's). */
export const toolRequestSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('get_symbol'), ref: symbolRefSchema }),
  z.object({ tool: z.literal('edit_symbol'), ref: symbolRefSchema, diff: diffSpecSchema }),
  z.object({ tool: z.literal('apply_patch'), target: z.string(), diff: diffSpecSchema }),
  z.object({ tool: z.literal('run_checks'), scope: z.string().optional() }),
  z.object({ tool: z.literal('invoke_asset'), bundleRef: z.string() }),
]);
export type ToolRequest = z.infer<typeof toolRequestSchema>;

/** The in-flight grounding block appended on a tool-boundary miss (L-GND). */
export const groundingBlockSchema = z.object({
  status: z.enum(['new', 'weak', 'stale']),
  named: z.string(),
  checkedAgainst: z.string(),
  suggestions: z.array(
    z.object({
      symbol: z.string(),
      signature: z.string().optional(),
      definedIn: z.string(),
      confidence: z.number(),
      why: z.string(),
    }),
  ),
  ifIntentional: z.string(),
});
export type GroundingBlock = z.infer<typeof groundingBlockSchema>;

/**
 * The enriched tool return (generic over the result payload `R`). A plain type,
 * not a Zod schema — the generic result is checked by each tool's own schema.
 */
export type ToolResponse<R> = {
  result: R;
  grounding?: GroundingBlock;
  flags?: InjectionBundle;
  handle: string;
  pointer: string;
};
