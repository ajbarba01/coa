import { z } from 'zod';

/**
 * One entry in the recent-projects list (the picker's MRU). `root` is the absolute
 * path the project's daemon is (or would be) rooted at; `name` is the directory's
 * basename, captured at open time so the list renders without re-touching the
 * filesystem. Zero cross-package imports — renderer-safe, like `settings.ts`.
 */
export const RecentProjectSchema = z.object({
  root: z.string(),
  name: z.string(),
  /** Epoch ms of the most recent open — sorts the MRU list, newest first. */
  lastOpenedAt: z.number(),
});
export type RecentProject = z.infer<typeof RecentProjectSchema>;

/**
 * Everything main persists about cross-project chrome: the MRU `recent` list (the
 * picker) and the project roots that were open — one per window — the moment the
 * app last quit, so launch can restore them. Neither field is UI chrome (theme,
 * layout, panel sizing stay in settings.json/layout.json, app-global and
 * project-independent per F11's ruled split) — this file is entirely about WHICH
 * projects, never how they look.
 */
export const ProjectsStateSchema = z.object({
  recent: z.array(RecentProjectSchema).default([]),
  openAtQuit: z.array(z.string()).default([]),
});
export type ProjectsState = z.infer<typeof ProjectsStateSchema>;

export const DEFAULT_PROJECTS_STATE: ProjectsState = { recent: [], openAtQuit: [] };

/** Parse persisted projects state, filling any missing field from defaults; any
 *  invalid blob (or `undefined`) yields the full defaults. Never throws. */
export function parseProjectsState(raw: unknown): ProjectsState {
  const parsed = ProjectsStateSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_PROJECTS_STATE;
}
