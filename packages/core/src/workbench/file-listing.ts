import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'tinyglobby';

/**
 * The `Glob` base tool's disk half: translate the worktree's `.gitignore` into
 * glob excludes and list files under a confined base. Kept out of the daemon
 * composition root because ignore translation is a parser with its own rules,
 * which change for entirely different reasons than which singletons the daemon binds.
 */

/** Always-ignored noise, regardless of the worktree's `.gitignore` (keeps tool results sane). */
const ALWAYS_IGNORE_GLOBS: readonly string[] = ['**/node_modules/**', '**/.git/**'];

/**
 * Translate `.gitignore` lines into `tinyglobby` `ignore` globs. A reasonable, not
 * exhaustive, translation: comments (`#…`) and blank lines are dropped; a
 * leading-slash (root-anchored) entry becomes a root-relative glob; a bare or
 * trailing-slash directory name becomes a recursive "anywhere under a dir named
 * this" ignore; anything else (e.g. `*.log`) passes through unchanged. Never throws.
 */
export function gitignoreToIgnoreGlobs(lines: readonly string[]): string[] {
  const globs: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (line.startsWith('/')) {
      const rest = line.slice(1).replace(/\/$/, '');
      globs.push(`${rest}/**`);
      continue;
    }
    if (line.endsWith('/')) {
      globs.push(`**/${line.slice(0, -1)}/**`);
      continue;
    }
    if (!line.includes('/') && !line.includes('*') && !line.includes('.')) {
      // A bare name with no extension-like dot or glob char: treat as a directory name.
      globs.push(`**/${line}/**`);
      continue;
    }
    globs.push(line);
  }
  return globs;
}

/** Read `<worktreeRoot>/.gitignore` (if present) and merge it with the always-ignore set. Never throws. */
export function ignoreGlobsFor(worktreeRoot: string): string[] {
  try {
    const text = readFileSync(join(worktreeRoot, '.gitignore'), 'utf8');
    return [...ALWAYS_IGNORE_GLOBS, ...gitignoreToIgnoreGlobs(text.split('\n'))];
  } catch {
    return [...ALWAYS_IGNORE_GLOBS];
  }
}

/**
 * The `listFiles` port body: glob under `baseAbsolute`, excluding node_modules/.git
 * plus anything the worktree's `.gitignore` names.
 */
export function listFilesFor(
  pattern: string,
  baseAbsolute: string,
  worktreeRoot?: string,
): string[] {
  const ignore = ignoreGlobsFor(worktreeRoot ?? baseAbsolute);
  return globSync(pattern, { cwd: baseAbsolute, absolute: true, dot: false, ignore });
}
