/**
 * Resolve which shell the pure-API `Bash` tool runs commands through.
 *
 * Node's `spawnSync(cmd, { shell: true })` resolves to `process.env.ComSpec`
 * (cmd.exe) on Windows — so a model that (correctly) writes POSIX one-liners
 * (`cat`, `tail`, pipes, `$(…)`, heredocs) hits a shell that doesn't understand
 * them. Claude Code avoids this by running its Bash tool through **Git Bash**;
 * Git for Windows is a documented prerequisite it detects rather than bundles.
 *
 * This mirrors that: on Windows we probe for Git Bash and, when found, hand its
 * absolute path to Node as the `shell` (Node invokes `bash.exe -c "<command>"` —
 * it only uses cmd's `/d /s /c` form for `cmd`/`command.com`). When no bash is
 * found we degrade to the platform default (never break the loop). Off
 * Windows the default shell is already `/bin/sh`, so we pass `true` untouched.
 */

/** Injected view of the environment so detection stays pure/testable. */
export interface ShellProbe {
  /** `process.platform`. */
  platform: NodeJS.Platform;
  /** `process.env`. */
  env: NodeJS.ProcessEnv;
  /** `existsSync` — tests whether a candidate bash path is present on disk. */
  fileExists: (path: string) => boolean;
}

export interface ShellResolution {
  /** The value for `spawnSync`'s `shell` option: an absolute bash path, or `true` for the platform default. */
  shell: string | true;
  /** Whether the resolved shell is a POSIX shell (Git Bash on Windows, or `/bin/sh` off it). */
  posix: boolean;
}

/** Environment variable to force a specific shell binary (highest precedence, all platforms). */
export const SHELL_OVERRIDE_ENV = 'COA_BASH_SHELL';

/**
 * A Git-install subdirectory that appears on PATH, and from which the install root
 * can be recovered: `…\Git\cmd`, `…\Git\usr\bin`, `…\Git\mingw64\bin`, etc.
 */
const GIT_PATH_SUBDIR = /\\(?:cmd|usr\\bin|mingw64\\bin|mingw32\\bin)\\?$/i;

/**
 * Build the ordered list of Windows Git Bash candidates. Ordering encodes a
 * preference for the `…\Git\bin\bash.exe` **wrapper** over the raw `…\usr\bin\bash.exe`:
 * the wrapper sets up the MSYS `PATH` (so `cat`/`tail`/etc. resolve) regardless of the
 * parent process, whereas the raw binary inherits the caller's `PATH` and would not
 * find the Unix tools when the daemon is launched from cmd/PowerShell.
 */
function windowsBashCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (path: string | undefined): void => {
    if (path === undefined || path === '') return;
    if (seen.has(path)) return;
    seen.add(path);
    candidates.push(path);
  };

  const pathDirs = (env['PATH'] ?? '')
    .split(';')
    .map((dir) => dir.trim().replace(/\\+$/, ''))
    .filter((dir) => dir !== '');

  // 1. The `bin\bash.exe` wrapper, recovered from any Git subdir found on PATH.
  for (const dir of pathDirs) {
    const root = dir.replace(GIT_PATH_SUBDIR, '');
    if (root !== dir) add(`${root}\\bin\\bash.exe`);
  }

  // 2. Common install roots (default Git-for-Windows layout, machine- and user-scoped).
  const localAppData = env['LOCALAPPDATA'];
  for (const root of [
    env['ProgramFiles'],
    env['ProgramFiles(x86)'],
    env['ProgramW6432'],
    localAppData !== undefined ? `${localAppData}\\Programs` : undefined,
  ]) {
    if (root !== undefined && root !== '') add(`${root}\\Git\\bin\\bash.exe`);
  }

  // 3. Last resort: a bash.exe sitting directly on a PATH dir (non-standard layouts).
  for (const dir of pathDirs) add(`${dir}\\bash.exe`);

  return candidates;
}

/**
 * A short, agent-facing label for a resolved shell — authored into the session's
 * environment block so the model knows to write POSIX (not cmd.exe) command lines.
 */
export function shellLabel(res: ShellResolution): string {
  if (!res.posix) return 'cmd.exe';
  if (res.shell === true) return '/bin/sh (POSIX)';
  return 'Git Bash (POSIX sh)';
}

/** Resolve the shell for the Bash tool given an injected view of the environment. */
export function resolveShell(probe: ShellProbe): ShellResolution {
  const override = probe.env[SHELL_OVERRIDE_ENV];
  if (override !== undefined && override !== '' && probe.fileExists(override)) {
    return { shell: override, posix: true };
  }

  // Off Windows the default shell is already `/bin/sh`; nothing to detect.
  if (probe.platform !== 'win32') return { shell: true, posix: true };

  for (const candidate of windowsBashCandidates(probe.env)) {
    if (probe.fileExists(candidate)) return { shell: candidate, posix: true };
  }

  // No POSIX shell available — degrade to the platform default (cmd.exe) rather than fail.
  return { shell: true, posix: false };
}
