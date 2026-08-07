// Archived from packages/shared/src/reminder.ts (the reminder-trigger event wire
// type, removed with the ReminderPolicy — its only consumer was this directory's
// reminder.ts). The live `Reminder` shape stays in the tree.
import { z } from 'zod';

/** The event a reminder anticipates — a pre-tool escape or a prompt boundary. */
export const escapeEventSchema = z.object({
  kind: z.enum(['pre-tool', 'prompt']),
  tool: z.string().optional(),
  scope: z.string().optional(),
});
export type EscapeEvent = z.infer<typeof escapeEventSchema>;
