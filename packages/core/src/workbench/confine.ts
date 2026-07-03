import path from 'node:path';
import type { CoaError } from '@coa/shared';
import { matchGlob } from '../scope/glob.js';

/**
 * M6 S-1 — the load-bearing path-confinement precondition. Because M6's
 * Retrieve/Mutate handlers are in-process MCP tools, the SDK OS sandbox does NOT
 * confine them (deny-rules bind built-in/bash tools, not custom MCP tools). So
 * every handler runs this deterministic check (no model call) before touching
 * disk or graph: resolve symlinks, then reject anything that escapes the session
 * worktree (`..`, an absolute path, a symlink target outside) or matches the
 * forbidden set (the kernel's `.coa/` home, or an injected `denyRead` glob).
 *
 * Confinement is computed in POSIX path space — the kernel addresses files with
 * forward-slash worktree-relative paths, so the math is deterministic and
 * OS-independent.
 */

/** The forbidden-within-worktree default: the kernel's WAL / projection / ledger home. */
export const WORKTREE_FORBIDDEN: readonly string[] = ['.coa/**'];

export interface ConfinementPolicy {
  /** The session worktree root — a POSIX absolute path; only paths under it are allowed. */
  worktreeRoot: string;
  /** Globs (worktree-relative) that are rejected even inside the worktree. Defaults to {@link WORKTREE_FORBIDDEN}. */
  denyRead?: readonly string[];
  /** Symlink resolver, injected for testability. Defaults to identity (no symlink on disk). */
  realpath?: (absolutePath: string) => string;
}

export type ConfineResult = { ok: true; path: string } | { ok: false; error: CoaError };

const escape = (candidate: string): ConfineResult => ({
  ok: false,
  error: { code: 'path-escape', message: `path escapes the worktree: ${candidate}` },
});

const denied = (rel: string): ConfineResult => ({
  ok: false,
  error: { code: 'path-denied', message: `path is in the forbidden set: ${rel}` },
});

/** Resolve `candidate` against the worktree and confine it, or reject with a typed error. */
export function confinePath(candidate: string, policy: ConfinementPolicy): ConfineResult {
  const root = policy.worktreeRoot;
  // A Windows worktree root is a drive-letter path (`C:/Users/…`), which POSIX does
  // NOT treat as absolute — `path.posix.resolve` would read it as relative and mangle
  // the result against cwd (`/…/cwd/C:/…`). Map any non-POSIX-absolute root into POSIX
  // space for the traversal math only; the returned path is rebuilt from the original
  // root so it stays OS-openable (Windows opens forward-slash drive paths).
  const posixRoot = path.posix.isAbsolute(root) ? root : `/${root}`;
  const resolved = path.posix.resolve(posixRoot, candidate);
  const real = policy.realpath ? policy.realpath(resolved) : resolved;
  const rel = path.posix.relative(posixRoot, real);
  // rel === '' is the worktree root itself — in-bounds, never an escape. Only
  // a `..` prefix (climbs above root) or an absolute-outside path escapes.
  if (rel.startsWith('..') || path.posix.isAbsolute(rel)) return escape(candidate);

  const forbidden = policy.denyRead ?? WORKTREE_FORBIDDEN;
  if (forbidden.some((glob) => matchGlob(glob, rel))) return denied(rel);

  // Rebuild from the ORIGINAL root (preserving its drive prefix) rather than the
  // POSIX-mapped `real`, so the fs-facing path is OS-openable. `rel === ''` is the
  // root itself.
  return { ok: true, path: rel === '' ? root : path.posix.join(root, rel) };
}
