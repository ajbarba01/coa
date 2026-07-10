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

/** An account as the console needs it: its label + which backend it authenticates
 *  (the locator/secret stay in the daemon). */
export const AccountSummarySchema = z.object({ label: z.string(), provider: z.string() });
export type AccountSummary = z.infer<typeof AccountSummarySchema>;

/** The active account label per provider (absent ⇒ that provider runs its ambient login). */
export const ActiveByProviderSchema = z.record(z.string(), z.string());
export type ActiveByProvider = z.infer<typeof ActiveByProviderSchema>;

export const AccountsSchema = z.object({
  accounts: z.array(AccountSummarySchema),
  active: ActiveByProviderSchema,
});
export type Accounts = z.infer<typeof AccountsSchema>;

export const ActiveAccountSchema = z.object({ active: ActiveByProviderSchema });
export type ActiveAccount = z.infer<typeof ActiveAccountSchema>;

/** A conversation turn frame — the console mock is shaped like the future turn-store
 *  frame so the mock→verb swap is a data-source change, not a reshape. The `raw`
 *  verbatim projection is a UI concern (derived in the shell), not a wire field. */
export const TurnRoleSchema = z.enum(['you', 'agent', 'subagent']);
export type TurnRole = z.infer<typeof TurnRoleSchema>;

export const TurnFrameSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    role: TurnRoleSchema,
    kind: z.literal('text'),
    text: z.string(),
    depth: z.number().optional(),
    // Piece B: an in-progress streaming block (fed by `text-delta`), replaced by the
    // settled `text` frame that follows. Absent ⇒ a committed block (docs/adr/0013).
    streaming: z.boolean().optional(),
  }),
  z.object({
    id: z.string(),
    role: TurnRoleSchema,
    kind: z.literal('tool-use'),
    tool: z.string(),
    input: z.string(),
    handle: z.string().optional(),
    depth: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    role: TurnRoleSchema,
    kind: z.literal('tool-result'),
    tool: z.string(),
    output: z.string(),
    ok: z.boolean(),
    handle: z.string().optional(),
    depth: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('approval'),
    requestId: z.string(),
    tool: z.string(),
    summary: z.string(),
    diffStat: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('deny'),
    denyKind: z.enum(['close-gate', 'cost-cap']),
    reason: z.string(),
  }),
  // A user stop, recorded in the append-only log — rendered as a quiet system line (never a
  // chat bubble, never an error). Mapped from the persisted frame, so live and reload match.
  z.object({ id: z.string(), kind: z.literal('interrupted') }),
  z.object({
    id: z.string(),
    role: TurnRoleSchema,
    kind: z.literal('thinking'),
    text: z.string(),
    depth: z.number().optional(),
    // Piece B: an in-progress streaming thinking block (fed by `thinking-delta`),
    // replaced by the settled `thinking` frame that follows (docs/adr/0013).
    streaming: z.boolean().optional(),
    // Persisted wall-clock (ms) the model spent reasoning — the reveal renders "Thought
    // for Ns" from it identically live and on reload (a token estimate is derived from
    // `text`, so it carries no field). Absent while streaming or on a non-streamed backend.
    durationMs: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    role: TurnRoleSchema,
    kind: z.literal('plan'),
    items: z.array(
      z.object({ text: z.string(), status: z.enum(['pending', 'in-progress', 'done']) }),
    ),
    depth: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    role: TurnRoleSchema,
    kind: z.literal('error'),
    message: z.string(),
    origin: z.enum(['tool', 'loop', 'daemon']).optional(),
    depth: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('subagent'),
    childWorktree: z.string(),
    event: z.enum(['spawn-proposal', 'spawn', 'running', 'idle', 'done', 'rollup']),
    depth: z.number().optional(),
    rollup: z
      .object({
        tools: z.number().optional(),
        tokens: z.number().optional(),
        cost: z.number().optional(),
        status: z.string().optional(),
      })
      .optional(),
  }),
]);
export type TurnFrame = z.infer<typeof TurnFrameSchema>;

export const TurnStreamSchema = z.array(TurnFrameSchema);
export type TurnStream = z.infer<typeof TurnStreamSchema>;
