import { z } from 'zod';
import { claudeEffortSchema } from './config.js';

/**
 * The user-editable model list (`~/.coa/models.yaml`), the single source of
 * truth for every place a model is chosen. Entries are per provider (the map key,
 * so an entry never repeats it). `origin` gates the remove-confirm in the editor:
 * a `custom` entry has no catalog to re-add from. Reads are drop-unknown /
 * never-throw at the store; unknown keys on an entry are stripped here.
 */

/** A model entry's reasoning override. `inherit` (the default when absent) resolves
 *  caps from the live fetch, then the shipped catalog defaults. */
export const reasoningProfileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inherit') }),
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('effort'), max: claudeEffortSchema }),
  z.object({ kind: z.literal('thinking') }),
  z.object({ kind: z.literal('budget'), tokens: z.number().int().positive() }),
]);
export type ReasoningProfile = z.infer<typeof reasoningProfileSchema>;

/** One editable model in a provider's list. The id is what goes on the wire, as-is. */
export const modelEntrySchema = z.object({
  id: z.string().min(1),
  /** Picker label; falls back to `id` when unset. */
  label: z.string().optional(),
  /** Dropped from the pickers, kept in the list. */
  hidden: z.boolean().optional(),
  origin: z.enum(['default', 'custom']).default('default'),
  /** Advanced; absent ⇒ inherit. */
  reasoning: reasoningProfileSchema.optional(),
});
export type ModelEntry = z.infer<typeof modelEntrySchema>;

/** The on-disk shape of `~/.coa/models.yaml`, keyed by provider. */
export const modelsFileSchema = z.object({
  version: z.literal(1).default(1),
  providers: z.record(z.string(), z.array(modelEntrySchema)).default({}),
});
export type ModelsFile = z.infer<typeof modelsFileSchema>;
