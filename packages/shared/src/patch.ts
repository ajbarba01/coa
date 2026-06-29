import { z } from 'zod';

/**
 * The edit/patch grammar. Lives in its own module because both the flag record
 * (a flag's optional `fix`) and the tool surface depend on it — keeping it
 * separate keeps `flag` and `tool` acyclic.
 */

/** The lenient edit grammar (Ruling-3): search-replace hunks, a unified patch, or a whole-file body. */
export const diffSpecSchema = z.discriminatedUnion('form', [
  z.object({
    form: z.literal('search-replace'),
    hunks: z.array(z.object({ find: z.string(), replace: z.string() })),
  }),
  z.object({ form: z.literal('unified'), patch: z.string() }),
  z.object({ form: z.literal('whole-file'), body: z.string() }),
]);
export type DiffSpec = z.infer<typeof diffSpecSchema>;

export const patchSchema = z.object({
  target: z.string(),
  diff: diffSpecSchema,
});
export type Patch = z.infer<typeof patchSchema>;
