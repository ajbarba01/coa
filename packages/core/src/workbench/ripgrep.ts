import { spawnSync } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import type { GrepHit, SearchRequest } from './base-tools.js';

/**
 * The `Grep` base tool's process half: run `@vscode/ripgrep`'s bundled binary and
 * turn its stdout into {@link GrepHit}s. Its own module because spawning a binary and
 * parsing its line format is an integration with a real tool, not composition —
 * the daemon root binds this port, it should not implement it.
 *
 * Never throws: a spawn failure yields empty stdout, which parses to no hits (a
 * search that found nothing, never an error the agent has to handle).
 */

/** Cap ripgrep's captured stdout so a runaway search cannot exhaust the daemon's memory. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** `rg --line-number` output: `<file>:<line>:<text>`, where the text itself may contain colons. */
const CONTENT_LINE = /^(.*?):(\d+):(.*)$/;

/** Windows paths come back backslashed; the whole tool surface speaks POSIX separators. */
function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Parse ripgrep stdout for the requested mode. `files` mode emits one path per line;
 * `content` mode emits `<file>:<line>:<text>` — a line that does not match that shape
 * degrades to a file-only hit rather than being dropped.
 */
export function parseRipgrepOutput(stdout: string, mode: SearchRequest['mode']): GrepHit[] {
  const lines = stdout.split('\n').filter((line) => line.length > 0);
  if (mode === 'files') return lines.map((file) => ({ file: toPosix(file) }));
  return lines.map((line) => {
    const m = CONTENT_LINE.exec(line);
    return m && m[1] !== undefined && m[2] !== undefined && m[3] !== undefined
      ? { file: toPosix(m[1]), line: Number(m[2]), text: m[3] }
      : { file: toPosix(line) };
  });
}

/** Build the ripgrep argv for a search request (`--` guards a pattern that starts with a dash). */
export function ripgrepArgs({ pattern, baseAbsolute, glob, mode }: SearchRequest): string[] {
  return [
    mode === 'files' ? '--files-with-matches' : '--line-number',
    ...(glob ? ['--glob', glob] : []),
    '--',
    pattern,
    baseAbsolute,
  ];
}

/** The `searchFiles` port body: run the bundled ripgrep and parse its hits. */
export function searchWithRipgrep(req: SearchRequest): GrepHit[] {
  const out = spawnSync(rgPath, ripgrepArgs(req), {
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  return parseRipgrepOutput(out.stdout ?? '', req.mode);
}
