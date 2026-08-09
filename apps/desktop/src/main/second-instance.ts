/**
 * Which project (if any) a second-instance launch is naming, from its argv.
 * Electron re-execs `second-instance` with the SAME argv the OS handed the new
 * process — the running binary's own path, in dev the script path too, plus
 * whatever the shell appended (e.g. a folder a future "open with coa" shell
 * association hands it) — so a named project, if any, is the LAST argument, and
 * only counts if it actually resolves to a real directory (never a flag, never
 * another executable's own path). `isDirectory` is injected so this stays pure
 * and testable without touching the filesystem.
 */
export function secondInstanceTarget(
  argv: readonly string[],
  isDirectory: (path: string) => boolean,
): string | undefined {
  const last = argv.at(-1);
  return last !== undefined && !last.startsWith('-') && isDirectory(last) ? last : undefined;
}
