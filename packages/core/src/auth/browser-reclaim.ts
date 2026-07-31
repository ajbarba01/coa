import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  browserProfileDir,
  browserUserDataDir,
  courierPath,
  isSafeProfileKey,
  launcherPath,
  profileKey,
} from './browser-paths.js';

/**
 * Finding and deleting cookie jars no account uses any more (docs/adr/0024).
 *
 * Separate from `browser-session.ts` on purpose: that module's job is to LAUNCH a login,
 * and enumerating dead directories is a different one. It borrows only the pure path
 * builders and the key function.
 *
 * Under identity keying the only way to mint an orphan is renaming an account's email, so
 * this list is normally empty — and a non-empty one is information rather than debris. The
 * pre-shared-root layout is not enumerated here at all: the clean break made
 * `~/.coa/browser-profiles/` dead in one piece, with no per-item decision to offer, so it is
 * removed by hand rather than through a surface (docs/adr/0024).
 *
 * ADR-0018 still binds: coa never deletes a profile on its own initiative. Everything here
 * runs because a user clicked.
 */

/** Marks a jar on its way out. The leading `.` fails {@link isSafeProfileKey}, so a trash
 *  name can never collide with a real key, and {@link listReclaimable} skips it. */
const TRASH_PREFIX = '.reclaim-';

/** Chrome writes one of these into every profile directory and into none of its shared
 *  component directories (verified 2026-07-31 against `component_crx_cache`, `Safe
 *  Browsing`, `WasmTtsEngine` and the rest) — so it is what tells a jar from Chrome's own
 *  furniture inside the shared root. */
const PROFILE_MARKER = 'Preferences';

export interface ReclaimDeps {
  home: string;
  platform: string;
  /** Injected so the whole module is testable without a filesystem. */
  exists(path: string): boolean;
  listDirs(path: string): string[];
  rename(from: string, to: string): void;
  remove(path: string): void;
  /** Injected so a trash name is deterministic in tests. */
  now?(): number;
}

/** Pure: the name a jar is moved aside to before deletion. */
export function trashName(key: string, now: number): string {
  return `${TRASH_PREFIX}${key}-${now}`;
}

/** Directory entries of `path`, or none when it does not exist yet — an absent profile root
 *  is the ordinary state before the first isolated login, never an error. */
function dirsIn(deps: ReclaimDeps, path: string): string[] {
  try {
    return deps.listDirs(path);
  } catch {
    return [];
  }
}

/**
 * Jars in the shared root that no account resolves to, newest layout only.
 *
 * `knownEmails` is every account's declared email — the caller passes the whole registry,
 * including accounts under other providers, because one jar can back several rows
 * (docs/adr/0021). A jar any live account resolves to never enters this list, so the
 * surface can never offer to sign a working login out.
 *
 * Sweeps any trash a previous failed deletion left behind on the way past.
 */
export function listReclaimable(
  deps: ReclaimDeps,
  knownEmails: readonly (string | undefined)[],
): string[] {
  const root = browserUserDataDir(deps.home);
  const live = new Set(
    knownEmails
      .map((email) => (email === undefined ? undefined : profileKey(email)))
      .filter((key): key is string => key !== undefined),
  );
  const reclaimable: string[] = [];
  for (const name of dirsIn(deps, root)) {
    if (name.startsWith(TRASH_PREFIX)) {
      // Left by a deletion that could not finish. Nothing references it; take it now.
      try {
        deps.remove(join(root, name));
      } catch {
        // Still locked. It stays invisible either way, and the next pass tries again.
      }
      continue;
    }
    if (!isSafeProfileKey(name)) continue;
    if (live.has(name)) continue;
    if (!deps.exists(join(root, name, PROFILE_MARKER))) continue;
    reclaimable.push(name);
  }
  return reclaimable;
}

/**
 * Delete one jar and the two files keyed alongside it, as {@link BrowserSession.removeProfile}
 * does — a profile is a triple, not a directory.
 *
 * Renames before deleting because a recursive delete of a jar whose window is open fails
 * PARTWAY: measured 2026-07-31, `rmSync` refused at a locked `journal.baj` and left 349
 * files behind, in a directory that still looked like a profile. A rename is atomic — it
 * succeeds whole or fails whole — so a locked jar stays intact and simply appears in the
 * list again, which is the whole error report the surface needs (SC-1: no error channel,
 * the list tells the truth).
 */
export function reclaimProfile(deps: ReclaimDeps, key: string): void {
  if (!isSafeProfileKey(key)) return;
  const trash = join(browserUserDataDir(deps.home), trashName(key, (deps.now ?? Date.now)()));
  try {
    deps.rename(browserProfileDir(deps.home, key), trash);
  } catch {
    // Could not move it — in use, or already gone. The shim and url stay too, so a jar that
    // survives keeps the launcher that reaches it, and it reappears in the list unchanged.
    return;
  }
  try {
    deps.remove(trash);
  } catch {
    // Moved aside but not gone: invisible to the list, swept on the next pass.
  }
  // The jar is committed to going, so the rest of the triple follows it.
  for (const path of [launcherPath(deps.home, key, deps.platform), courierPath(deps.home, key)]) {
    try {
      deps.remove(path);
    } catch {
      // A leftover shim is a stale file, never a failed reclaim.
    }
  }
}

/** The default filesystem-backed deps. Kept here so callers wire one object, not six. */
export function nodeReclaimDeps(home: string, platform: string): ReclaimDeps {
  return {
    home,
    platform,
    exists: existsSync,
    listDirs: (path) =>
      readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    rename: renameSync,
    remove: (path) => rmSync(path, { recursive: true, force: true }),
  };
}
