import { feedViewSchema, modelMetadataSchema, type FeedView } from '@coa/shared';
import { z } from 'zod';

/** The honest user feed — re-exported from the shared wire type so the console
 *  validates the real shape. */
export const FeedViewSchema = feedViewSchema;
export type { FeedView };

/** A timeline checkpoint from the change-event spine. Mirrors the core shape; the renderer cannot import
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

// `system` is a coa-authored notice (e.g. a child session's ending — never a
// person and never the agent's own claim). Scoped to `text` alone — the only
// kind that ever carries it, matching the wire's own `text` role enum
// (@coa/shared's `turnFrameSchema`) — rather than widening `TurnRoleSchema`
// itself, which every other kind's `role` field also uses and which never
// produces `system` (widening it there would only invite a value the mapper
// never emits).
export const TextRoleSchema = z.enum(['you', 'agent', 'subagent', 'system']);
export type TextRole = z.infer<typeof TextRoleSchema>;

export const TurnFrameSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    role: TextRoleSchema,
    kind: z.literal('text'),
    text: z.string(),
    depth: z.number().optional(),
    // Piece B: an in-progress streaming block (fed by `text-delta`), replaced by the
    // settled `text` frame that follows (deltas are delivery-only, never persisted).
    // Absent ⇒ a committed block.
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
    denyKind: z.enum(['close-gate']),
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
    // replaced by the settled `thinking` frame that follows (deltas are delivery-only, never persisted).
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

/** A credential as the Auth surface needs it — matches the renderer's `Credential` interface.
 *  Phase-2 fields (identity/plan/expired/lastUsed) are optional and unset until the usage read. */
export const CredentialViewSchema = z
  .object({
    id: z.string(),
    providerId: z.string(),
    label: z.string(),
    masked: z.string(),
    disabled: z.boolean(),
    coolingSec: z.number().optional(),
    identity: z.string().optional(),
    plan: z.string().optional(),
    expired: z.boolean().optional(),
    lastUsed: z.string().optional(),
    email: z.string().optional(),
    health: z.enum(['healthy', 'needs-relogin']).optional(),
    hasProfile: z.boolean().optional(),
    profileShared: z.boolean().optional(),
  })
  .strip();
export type CredentialView = z.infer<typeof CredentialViewSchema>;

/** The driven-login flow snapshot the renderer polls while its dialog is open.
 *  `idle` is the flow-less answer — a state, never an error. */
export const LoginSnapshotSchema = z
  .object({
    phase: z.enum([
      'idle',
      'launching',
      'awaiting',
      'watching',
      'registered',
      // The dir was already signed in before the flow began, so nothing this attempt did
      // can be credited for it — a decision, not a success (login health is probe-derived).
      'preexisting',
      'mismatch',
      'failed',
    ]),
    mode: z.enum(['new', 'relogin']).optional(),
    email: z.string().optional(),
    credentialId: z.string().optional(),
    oauthUrl: z.string().optional(),
    ptyCaptured: z.boolean().optional(),
    landedEmail: z.string().optional(),
    identity: z.string().optional(),
    error: z.string().optional(),
  })
  .strip();
export type LoginSnapshot = z.infer<typeof LoginSnapshotSchema>;

export const AuthViewSchema = z
  .object({
    added: z.array(z.string()),
    credentials: z.array(CredentialViewSchema),
    activeByProvider: z.record(z.string(), z.string()),
    enabled: z.record(z.string(), z.boolean()),
    chains: z.record(z.string(), z.array(z.string())),
    /** Defaulted, not required: an older daemon that predates isolation still parses. */
    browserSession: z
      .object({
        enabled: z.boolean(),
        available: z.boolean(),
        detectedPath: z.string().optional(),
        path: z.string().optional(),
        /** Jars no account resolves to. Defaulted, so a daemon that predates the reclaim
         *  surface reads as "nothing to reclaim" rather than failing the whole view. */
        reclaimable: z.array(z.string()).default([]),
      })
      .strip()
      .default({ enabled: false, available: false, reclaimable: [] }),
  })
  .strip();
export type AuthView = z.infer<typeof AuthViewSchema>;

/** A model entry as the editor needs it — mirrors the shared wire shape; the renderer
 *  cannot import `@coa/shared`'s server modules, so the edge schema lives here. */
export const ReasoningProfileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inherit') }),
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('effort'), max: z.enum(['low', 'medium', 'high', 'xhigh', 'max']) }),
  z.object({ kind: z.literal('thinking') }),
  z.object({ kind: z.literal('budget'), tokens: z.number().int().positive() }),
]);
export type ReasoningProfile = z.infer<typeof ReasoningProfileSchema>;

export const ModelEntrySchema = z
  .object({
    id: z.string(),
    label: z.string().optional(),
    hidden: z.boolean().optional(),
    origin: z.enum(['default', 'custom']),
    reasoning: ReasoningProfileSchema.optional(),
  })
  .strip();
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ModelCatalogViewSchema = z
  .object({
    lists: z.record(z.string(), z.array(ModelEntrySchema)),
    catalog: z.record(z.string(), z.array(ModelEntrySchema)),
  })
  .strip();
export type ModelCatalogView = z.infer<typeof ModelCatalogViewSchema>;

/** The `modelMetadata` verb's reply — every known row (optionally provider-filtered
 *  server-side by the request params). */
export const ModelMetadataViewSchema = z.object({ entries: z.array(modelMetadataSchema) }).strip();
export type ModelMetadataView = z.infer<typeof ModelMetadataViewSchema>;
