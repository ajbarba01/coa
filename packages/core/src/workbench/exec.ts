import { spawnSync } from 'node:child_process';
import type { ExecOptions, ExecResult } from './base-tools.js';

/**
 * The `Bash` base tool's process half: run a command line through a resolved shell.
 * Its own module because "how a child process is spawned and how its failure is
 * reported" is an integration detail, not composition — the daemon root picks the
 * shell and binds this port, it should not implement it.
 */

/** Cap captured output so a runaway command cannot exhaust the daemon's memory. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * Build the `exec` port over `spawnSync`, running commands through `shell`
 * (an absolute shell path, or `true` for the platform default).
 *
 * Never throws. A spawn failure — a missing shell, a timeout kill — comes back as a
 * non-zero exit with the failure on stderr, which the agent reads as a command that
 * failed and can retry. Surfacing it as a thrown error would turn a bad command line
 * into a broken tool.
 */
export function createExec(
  shell: string | true,
): (command: string, opts: ExecOptions) => ExecResult {
  return (command, opts) => {
    const out = spawnSync(command, {
      cwd: opts.cwd,
      shell,
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES,
      ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
    });
    return {
      stdout: out.stdout ?? '',
      stderr: out.stderr ?? (out.error ? String(out.error.message) : ''),
      exitCode: out.status ?? (out.error ? -1 : 0),
    };
  };
}
