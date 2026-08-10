// Archived from packages/shared/src/graph.ts (the fuzzy-lookup wire shape, removed
// with the kernel's `fuzzyMatch` read — the producer here was its only consumer;
// nothing in production ever populated the index it queried).
import { z } from 'zod';
import { symbolRecordSchema } from '@coa/shared';

/** A fuzzy-match candidate from the spine's fuzzy lookup, each carrying an explicit confidence. */
export const rankedCandidateSchema = z.object({
  symbol: symbolRecordSchema,
  confidence: z.number(),
  why: z.string(),
});
export type RankedCandidate = z.infer<typeof rankedCandidateSchema>;
