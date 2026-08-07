// Archived from packages/shared/src/governance.ts
import { z } from 'zod';

/**
 * The governance change-event payload (M7's `appendGovernance` write path) — a
 * discriminated union on `sub` carrying the typed body. The prose-bearing bodies
 * (the D73 decision `entry`, the D137 vouch `note`, the D147 subtractive `diff`)
 * ride here so they live in the kernel's WAL (M1) — WAL-local by construction — and
 * are structurally excluded from the sync-eligible ledger, whose own `record()`
 * keeps only the D135 allow-list (DT-5). The `cap-record` body is pure numerics
 * (allow-listed), so it is safe in both places.
 */
export const decisionPayloadSchema = z.object({
  sub: z.literal('decision'),
  /** The keyed target (serves `findByTarget`/`why`). */
  target: z.string(),
  /** The prose decision text — WAL-local (DT-5). */
  entry: z.string(),
});

export const vouchPayloadSchema = z.object({
  sub: z.literal('vouch'),
  /** The vouched graph node. */
  node: z.string(),
  /** The commit hash the human confirmation is pinned to (`vouched-at`). */
  vouchedAt: z.string(),
  /** An optional prose note — WAL-local (DT-5). */
  note: z.string().optional(),
});

export const capRecordPayloadSchema = z.object({
  sub: z.literal('cap-record'),
  tokensIn: z.number(),
  tokensOut: z.number(),
  costUsd: z.number(),
});

export const subtractiveChangePayloadSchema = z.object({
  sub: z.literal('subtractive-change'),
  /** The rule/scope being weakened. */
  target: z.string(),
  /** A description of the subtractive change — WAL-local (DT-5). */
  diff: z.string(),
});

export const governancePayloadSchema = z.discriminatedUnion('sub', [
  decisionPayloadSchema,
  vouchPayloadSchema,
  capRecordPayloadSchema,
  subtractiveChangePayloadSchema,
]);
export type GovernancePayload = z.infer<typeof governancePayloadSchema>;
