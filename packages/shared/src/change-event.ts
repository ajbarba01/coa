import { z } from 'zod';
import { edgeTypeSchema, symbolRecordSchema } from './graph.js';
import { governancePayloadSchema } from './governance.js';

/**
 * The change-event log line frame (D126 clause 1). The durable log is NDJSON:
 * one Zod-validated change-event per line, single-writer (the daemon). The frame
 * is a discriminated union on `kind`; M0 owns the schema, M1 owns the runtime.
 *
 * Wire field names follow the on-disk frame verbatim (`schema_version`,
 * `pre_hash`, `post_hash`, `op_id`) — snake_case is the NDJSON contract.
 */

/** The current frame schema version. The reader runs frame-schema-migration up to this; a higher version quarantines. */
export const SCHEMA_VERSION = 2;

const causeSchema = z
  .object({ kind: z.literal('regenerate'), sourceEventSeq: z.number().int().nonnegative() })
  .nullable();

/** Fields shared by every frame, regardless of `kind`. */
const envelopeShape = {
  schema_version: z.literal(SCHEMA_VERSION),
  seq: z.number().int().nonnegative(),
  ts: z.string(),
  worktree: z.string(),
  actor: z.enum(['session', 'reconciler', 'human']),
  /** Non-null for all precise + edge + governance kinds; null ONLY for a bare reconciler file observation. */
  op_id: z.string().nullable(),
  provenance: z.enum(['declared', 'inferred', 'gated']),
  /** Optional regenerate provenance the WAL preserves (M4 stamps it). */
  cause: causeSchema,
};

/** The five FILE-change kinds — the only kinds subject to causal dedup. */
export const FILE_KINDS = ['modify', 'create', 'delete', 'rename', 'confirm'] as const;

const fileChangeSchema = z.object({
  ...envelopeShape,
  kind: z.enum(FILE_KINDS),
  path: z.string(),
  /** The causal transition key (null for create). */
  pre_hash: z.string().nullable(),
  /** Null for delete. */
  post_hash: z.string().nullable(),
  /** True ⇒ a reconcile-include gitignored path (lower trust, inferred). */
  generated: z.boolean(),
});
export type FileChangeEvent = z.infer<typeof fileChangeSchema>;

const edgeChangeSchema = z.object({
  ...envelopeShape,
  // edge/symbol/governance frames always carry a non-null op_id and declared|gated provenance.
  op_id: z.string(),
  provenance: z.enum(['declared', 'gated']),
  kind: z.enum(['assert-edge', 'retract-edge']),
  payload: z.object({
    from: z.string(),
    to: z.string(),
    type: edgeTypeSchema,
    why: z.string().optional(),
  }),
});
export type EdgeChangeEvent = z.infer<typeof edgeChangeSchema>;

const declareSymbolsSchema = z.object({
  ...envelopeShape,
  op_id: z.string(),
  provenance: z.enum(['declared', 'gated']),
  kind: z.literal('declare-symbols'),
  payload: z.object({ symbols: z.array(symbolRecordSchema), from: z.string() }),
});
export type DeclareSymbolsEvent = z.infer<typeof declareSymbolsSchema>;

const governanceChangeSchema = z.object({
  ...envelopeShape,
  op_id: z.string(),
  provenance: z.enum(['declared', 'gated']),
  kind: z.literal('governance'),
  payload: governancePayloadSchema,
});
export type GovernanceChangeEvent = z.infer<typeof governanceChangeSchema>;

/** One canonical change-event. The union of all frame kinds. */
export const changeEventSchema = z.union([
  fileChangeSchema,
  edgeChangeSchema,
  declareSymbolsSchema,
  governanceChangeSchema,
]);
export type ChangeEvent = z.infer<typeof changeEventSchema>;
