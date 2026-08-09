import type { RecentProject } from '../shared/projects.js';

/** The recent-projects picker keeps at most this many entries. */
const MAX_RECENT = 20;

/**
 * Move `entry` to the front of `recent`, deduping by project IDENTITY (never raw
 * string equality — `canonicalize` is the same rule `defaultDaemonPath`/the window
 * registry use, injected here to keep this module free of any cross-package
 * import), capped at {@link MAX_RECENT}. Pure: the persistence wrapper (main's
 * `readJson`/`writeJson` around `projects.json`) is a thin shell around this.
 */
export function recordRecentProject(
  recent: readonly RecentProject[],
  entry: RecentProject,
  canonicalize: (root: string) => string,
): RecentProject[] {
  const key = canonicalize(entry.root);
  const deduped = recent.filter((r) => canonicalize(r.root) !== key);
  return [entry, ...deduped].slice(0, MAX_RECENT);
}
