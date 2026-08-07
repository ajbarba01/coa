import { z } from 'zod';

/** The console's persisted UI preferences. New toggles just add a defaulted field. */
export const ConsoleSettingsSchema = z.object({
  /** Pinned: the console ships exactly one theme (sand dark). A stale persisted value
   *  (an old `'light'`/`'system'`) degrades to it rather than voiding the whole blob. */
  theme: z.literal('dark').catch('dark').default('dark'),
  motion: z.enum(['full', 'reduce']).default('full'),
  /** Agent refs the user pinned — a user-local preference (never written into a
   *  Role; a project agent's pin state is yours, not the repo's). */
  pinnedAgents: z.array(z.string()).default([]),
  /** Rebound shortcuts: command id → chord (`[]` = the user unbound it). Only ids the
   *  registry still knows are honoured, so a stale entry can't invent a command. */
  keybinds: z.record(z.string(), z.array(z.string())).default({}),
  /** The Ctrl+/- window zoom level (Electron zoom levels; each ≈20%). Main owns this
   *  field — it's driven by the keybindings and applied via `setZoomLevel`, not a
   *  renderer toggle — so `saveSettings` preserves the on-disk value (a garbage value
   *  degrades to `0`, i.e. 100%). */
  zoomLevel: z.number().int().catch(0).default(0),
});
export type ConsoleSettings = z.infer<typeof ConsoleSettingsSchema>;

export const DEFAULT_SETTINGS: ConsoleSettings = {
  theme: 'dark',
  motion: 'full',
  pinnedAgents: [],
  keybinds: {},
  zoomLevel: 0,
};

/** Parse persisted settings, filling any missing field from defaults; any invalid
 *  blob (or `undefined`) yields the full defaults. Never throws. */
export function parseSettings(raw: unknown): ConsoleSettings {
  const parsed = ConsoleSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
