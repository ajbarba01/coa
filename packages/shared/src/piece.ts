import { z } from 'zod';

import { slotIdSchema } from './slots.js';

/**
 * The ONE composable content atom (the content-taxonomy collapse). The former kinds
 * (knowledge/protocol/behaviour) dissolve into three orthogonal axes; `Role`
 * stays a separate type (see {@link BundleManifest}). Authority is a
 * `governed-by` graph edge, not a front-matter flag. This package owns the type;
 * the axis→slot compilation is the config compiler's.
 */

/** The three orthogonal content axes. */
export const contentAxesSchema = z.object({
  /** `pull` = body pulled on demand; `push` = delivered into context (scope-gated iff `scope` set). */
  delivery: z.enum(['pull', 'push']),
  scope: z.string().optional(),
  /** Reminder eagerness. `never` or a "tokens since last reminder" cadence (Tier-0). */
  salience: z.union([z.literal('never'), z.object({ cadenceTokens: z.number() })]),
  /** The GEN-7 trust axis — grounding may use `authored`, never `derived-from-code`. */
  provenance: z.enum(['authored', 'derived-from-code']),
  /** CC `disable-model-invocation`. */
  manualOnly: z.boolean().optional(),
});
export type ContentAxes = z.infer<typeof contentAxesSchema>;

export const pieceSchema = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  axes: contentAxesSchema,
  /** Which DC-6 section this Piece renders in; absent ⇒ the end bucket (rendered last, no header). */
  slot: slotIdSchema.optional(),
  /** The authority link — `governed-by` edges to constraints. */
  governedBy: z.array(z.string()).optional(),
  bundle: z.string().optional(),
  /** The import-trust descriptor. */
  source: z
    .object({
      origin: z.string(),
      version: z.string().optional(),
      importTrust: z.enum(['trusted', 'untrusted']),
    })
    .optional(),
  /** CC/plugin-native front-matter keys that round-trip verbatim. */
  ccKeys: z.record(z.string(), z.unknown()).optional(),
});
export type Piece = z.infer<typeof pieceSchema>;

/** A piece with its position in a compiled prefix slot. */
export const orderedPieceSchema = z.object({
  piece: pieceSchema,
  order: z.number(),
});
export type OrderedPiece = z.infer<typeof orderedPieceSchema>;
