import { z } from 'zod';

/** The authority-reminder M3 decides and M9 delivers (D107/D133). */
export const reminderSchema = z.object({
  rule: z.string(),
  reason: z.string(),
  /** Tier 0 = deterministic re-surface, A = trigger-term match, B = learned (deferred). */
  tier: z.union([z.literal(0), z.literal('A'), z.literal('B')]),
});
export type Reminder = z.infer<typeof reminderSchema>;

/** The event M3.reminderFor anticipates — a pre-tool escape or a prompt boundary. */
export const escapeEventSchema = z.object({
  kind: z.enum(['pre-tool', 'prompt']),
  tool: z.string().optional(),
  scope: z.string().optional(),
});
export type EscapeEvent = z.infer<typeof escapeEventSchema>;
