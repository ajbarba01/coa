import { z } from 'zod';

/** The authority-reminder the governor decides and the backend adapter delivers. */
export const reminderSchema = z.object({
  rule: z.string(),
  reason: z.string(),
  /** Tier 0 = deterministic re-surface, A = trigger-term match, B = learned (deferred). */
  tier: z.union([z.literal(0), z.literal('A'), z.literal('B')]),
});
export type Reminder = z.infer<typeof reminderSchema>;
