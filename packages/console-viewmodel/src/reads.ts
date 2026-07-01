import { feedViewSchema, type FeedView } from '@coa/shared';
import { z } from 'zod';

/** The CF-1 user feed (M3) — re-exported from the M0 wire type so the console
 *  validates the real shape. */
export const FeedViewSchema = feedViewSchema;
export type { FeedView };

/** A timeline checkpoint (M1). Mirrors the core shape; the renderer cannot import
 *  `@coa/core`, so the edge schema lives here (pure). Unknown fields are stripped. */
export const CheckpointSchema = z.object({
  id: z.string(),
  seq: z.number(),
  ts: z.string(),
  worktree: z.string(),
  pinned: z.boolean(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const TimelineSchema = z.array(CheckpointSchema);

/** An account pointer as the console needs it (label only; the daemon's provider/
 *  locator are stripped). */
export const AccountSummarySchema = z.object({ label: z.string() });
export type AccountSummary = z.infer<typeof AccountSummarySchema>;

export const AccountsSchema = z.object({ accounts: z.array(AccountSummarySchema) });
export type Accounts = z.infer<typeof AccountsSchema>;

export const ActiveAccountSchema = z.object({ active: z.string() });
export type ActiveAccount = z.infer<typeof ActiveAccountSchema>;
