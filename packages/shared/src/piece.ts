import { z } from 'zod';

/**
 * The ONE composable content atom (the TAX-* collapse). The former kinds
 * (knowledge/protocol/behaviour) dissolve into three orthogonal axes; `Role`
 * stays a separate type (see {@link BundleManifest}). Authority is a
 * `governed-by` graph edge (TAX-2), not a front-matter flag. M0 owns the type;
 * the axis→slot compilation is M5's.
 */

/** The three orthogonal content axes (TAX-1). */
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
  /** The TAX-2 authority link — `governed-by` edges to constraints. */
  governedBy: z.array(z.string()).optional(),
  bundle: z.string().optional(),
  /** The D31 import-trust descriptor. */
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
