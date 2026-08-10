// Archived from packages/shared/src/tool.ts (the grounding half of the tool wire
// types, removed with the producer). ToolResponse also carried an optional
// `grounding?: GroundingBlock` field that the enrich decorator populated.
import { z } from 'zod';

/** The in-flight grounding block appended on a tool-boundary symbol near-miss. */
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
