import { resolve, relative, isAbsolute, sep } from 'node:path';

/**
 * Confine a (worktree-relative or absolute) candidate path to a session's worktree
 * root, resolving it to an OS-openable absolute path. The reveal IPC's load-bearing
 * safety check: the console must never open a file outside the session's worktree, so
 * anything that climbs above the root (`..`, an absolute path elsewhere, a drive
 * change on Windows) is rejected here before any spawn/reveal.
 *
 * Uses the OS-native `node:path` (main runs on the real OS, unlike the kernel's
 * POSIX-space confinement), and compares case-insensitively only where the platform is
 * (Windows), via a normalized boundary check. Pure; never throws — a bad input returns
 * `undefined` rather than raising.
 */
export function confineToWorktree(root: string, candidate: string): string | undefined {
  if (root.length === 0) return undefined;
  const absoluteRoot = resolve(root);
  const resolved = resolve(absoluteRoot, candidate);
  const rel = relative(absoluteRoot, resolved);
  // `rel === ''` is the root itself (in-bounds). A `..` segment climbs above the root;
  // an absolute `rel` means a different drive/root entirely — both escape.
  if (rel === '') return resolved;
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return resolved;
}

/** cmd.exe metacharacters we refuse to route through `cmd.exe /c` on Windows as
 *  defense-in-depth. A SPACE is deliberately NOT here — Node's `shell:false` argument
 *  quoting keeps a spaced path a single argument, so the reveal's original `shell:true`
 *  split-at-space bug is fixed by the spawn, not by this guard. But `%…%`/`!…!` are
 *  expanded by cmd even inside quotes, and `&|<>^()"`/CR/LF are cmd operators; the agent
 *  can NAME a file with these, and the (worktree-confined) path must never reach cmd
 *  carrying one — the reveal falls back to the shell-free folder view instead. (POSIX
 *  spawns `code` directly with no shell, so only Windows needs this guard.) */
const WINDOWS_SHELL_METACHARS = /[&|<>^"%()!\r\n]/;

/** Whether `path` is safe to route through `cmd.exe /c code` on Windows. Spaces are allowed
 *  (Node's argument quoting handles them); cmd-interpreted metacharacters are refused. */
export function safeForWindowsShell(path: string): boolean {
  return !WINDOWS_SHELL_METACHARS.test(path);
}

/**
 * The `{ command, args }` to spawn `code -g <file>[:<line>]` (open at a line), per platform.
 * The invocation is designed to be spawned with `shell: false`, so Node applies Win32
 * argument quoting and a path with spaces stays a SINGLE argument (no shell word-splitting):
 *  - Windows: `code` is `code.cmd`, a batch shim. Node ≥18.20/20.12 refuses to spawn a
 *    `.bat`/`.cmd` without a shell (CVE-2024-27980), so route through `cmd.exe /c code`
 *    (shell:false) — cmd resolves `code` on PATH and Node still quotes the file argument.
 *  - POSIX: `code` is a normal executable; spawn it directly.
 * Pure; the caller spawns the result. */
export function codeInvocation(
  platform: NodeJS.Platform,
  absPath: string,
  line: number | undefined,
): { command: string; args: string[] } {
  const fileArg = line !== undefined ? `${absPath}:${line}` : absPath;
  if (platform === 'win32') {
    return { command: 'cmd.exe', args: ['/c', 'code', '-g', fileArg] };
  }
  return { command: 'code', args: ['-g', fileArg] };
}
