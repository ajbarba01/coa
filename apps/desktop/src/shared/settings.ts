import { z } from 'zod';

/** The console's persisted UI preferences. New toggles just add a defaulted field. */
export const ConsoleSettingsSchema = z.object({
  theme: z.enum(['system', 'dark', 'light']).default('dark'),
  density: z.enum(['comfortable', 'compact']).default('compact'),
  motion: z.enum(['full', 'reduce']).default('full'),
  /** Agent refs the user pinned — a user-local preference (never written into a
   *  Role; a project agent's pin state is yours, not the repo's). */
  pinnedAgents: z.array(z.string()).default([]),
});
export type ConsoleSettings = z.infer<typeof ConsoleSettingsSchema>;

export const DEFAULT_SETTINGS: ConsoleSettings = {
  theme: 'dark',
  density: 'compact',
  motion: 'full',
  pinnedAgents: [],
};

/** Parse persisted settings, filling any missing field from defaults; any invalid
 *  blob (or `undefined`) yields the full defaults. Never throws. */
export function parseSettings(raw: unknown): ConsoleSettings {
  const parsed = ConsoleSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
