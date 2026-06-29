import { z } from 'zod';
import { capabilityFrameSchema } from './capability.js';
import { contextPackageRefSchema } from './context.js';
import { orderedPieceSchema, pieceSchema } from './piece.js';
import { reminderSchema } from './reminder.js';

/**
 * The backend-NEUTRAL compiled config (M5's output; authoritative here per
 * D-CAT, M5 cross-references). The slot set is unchanged by the TAX-* collapse —
 * the axes are a front-end over these same slots (D105 intact).
 */
export const neutralConfigSchema = z.object({
  prefixHead: z.array(orderedPieceSchema),
  systemReminders: z.array(reminderSchema),
  onDemandPullable: z.array(z.string()),
  scopePushed: z.array(pieceSchema),
  toolIntents: capabilityFrameSchema,
  assembledContextSlot: contextPackageRefSchema.optional(),
});
export type NeutralConfig = z.infer<typeof neutralConfigSchema>;

export const sessionConfigSchema = z.object({
  role: z.string(),
  scope: z.string(),
  worktree: z.string(),
  capabilityFrame: capabilityFrameSchema,
});
export type SessionConfig = z.infer<typeof sessionConfigSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  config: sessionConfigSchema,
  worktree: z.string(),
});
export type Session = z.infer<typeof sessionSchema>;
