import { z } from 'zod';

/**
 * Byte→structure types owned here so the code-intel layer and the change-event
 * spine both compile against them; `CST` is serializable across the parser
 * child-process boundary.
 */

/** A concrete syntax tree. `tree` is opaque and serializable across the parser-process boundary. */
export const cstSchema = z.object({
  lang: z.string(),
  tree: z.unknown(),
  bytesHash: z.string(),
});
export type CST = z.infer<typeof cstSchema>;

/** The canonical form — "equal modulo formatting?" reduces to comparing two of these. */
export const canonicalFormSchema = z.object({
  lang: z.string(),
  canonicalBytes: z.string(),
});
export type CanonicalForm = z.infer<typeof canonicalFormSchema>;

/** The language tier: 0 = universal floor, 1 = outline, 2 = tags/refs. */
export const tierSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type Tier = z.infer<typeof tierSchema>;

/** Inputs to {@link canonicalForm} canonicalization (banner stripping, key sorting, ignored regions). */
export const canonicalizationProfileSchema = z.object({
  lang: z.string(),
  stripBanner: z.boolean().optional(),
  sortKeys: z.boolean().optional(),
  ignoreRegions: z.array(z.tuple([z.number(), z.number()])).optional(),
});
export type CanonicalizationProfile = z.infer<typeof canonicalizationProfileSchema>;
